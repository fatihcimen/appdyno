// H.264 and HEVC in Annex B, decoded by VideoToolbox in hardware where the Mac has it. One path for a
// window, a headless run and the self test, so that what is tested is what shows. The images go to the
// sink, and only whole pictures: after a loss nothing is decoded until the next keyframe.
#import "Viewer.h"
#import <os/lock.h>

// memory is bounded by these, and no frame is kept to catch up
enum { kMaxInFlight = 3, kMaxParameterSet = 4096 };

void MVForEachNal(const uint8_t *data, size_t length, void (^found)(const uint8_t *nal, size_t length)) {
  size_t start = 0;
  BOOL open = NO;
  for (size_t i = 0; i + 3 <= length; i++) {
    if (data[i] != 0 || data[i + 1] != 0 || data[i + 2] != 1) continue;
    if (open) {
      size_t end = i;
      while (end > start && data[end - 1] == 0) end--;
      if (end > start) found(data + start, end - start);
    }
    start = i + 3;
    open = YES;
    i += 2;
  }
  if (open && length > start) found(data + start, length - start);
}

typedef NS_ENUM(int, NalKind) { NalSlice, NalKeySlice, NalVps, NalSps, NalPps, NalOther };

static NalKind nalKind(const uint8_t *nal, size_t length, BOOL hevc) {
  if (hevc) {
    if (length < 2) return NalOther;
    int type = (nal[0] >> 1) & 0x3f;
    if (type == 32) return NalVps;
    if (type == 33) return NalSps;
    if (type == 34) return NalPps;
    if (type >= 16 && type <= 21) return NalKeySlice;
    return type < 10 ? NalSlice : NalOther;
  }
  if (length < 1) return NalOther;
  int type = nal[0] & 0x1f;
  if (type == 7) return NalSps;
  if (type == 8) return NalPps;
  if (type == 5) return NalKeySlice;
  return type >= 1 && type <= 4 ? NalSlice : NalOther;
}

@interface MVDecoder ()
- (void)finished:(OSStatus)status image:(CVImageBufferRef _Nullable)image startedAt:(double)startedAt;
@end

static void onDecoded(void *owner, void *refcon, OSStatus status, VTDecodeInfoFlags flags, CVImageBufferRef image, CMTime pts, CMTime duration) {
  double *startedAt = refcon;
  [(__bridge MVDecoder *)owner finished:status image:image startedAt:*startedAt];
  free(startedAt);
}

static const double kRecorderAskMs = 1000;

@implementation MVDecoder {
  __weak id<MVSink> _sink;
  __weak id _source;
  NSData *_vps, *_sps, *_pps;
  CMVideoFormatDescriptionRef _format;
  VTDecompressionSessionRef _session;
  BOOL _formatStale;
  os_unfair_lock _lock;
  BOOL _awaitingKey;
  int _inFlight, _failures;
  BOOL _closed;
  BOOL _pixelsTold;
  double _recorderAskedAt;
}

- (instancetype)initWithSink:(id<MVSink>)sink from:(id)source {
  if ((self = [super init])) {
    _sink = sink;
    _source = source;
  }
  return self;
}

- (void)dealloc {
  [self close];
}

- (void)close {
  os_unfair_lock_lock(&_lock);
  _closed = YES;
  os_unfair_lock_unlock(&_lock);
  [self endSession];
  if (_format) CFRelease(_format);
  _format = NULL;
}

- (void)endSession {
  if (!_session) return;
  VTDecompressionSessionWaitForAsynchronousFrames(_session);
  VTDecompressionSessionInvalidate(_session);
  CFRelease(_session);
  _session = NULL;
}

- (void)awaitKey {
  os_unfair_lock_lock(&_lock);
  _awaitingKey = YES;
  int failures = _failures;
  os_unfair_lock_unlock(&_lock);
  [self askForKey:failures];
}

- (void)askForKey:(int)failures {
  id<MVSink> sink = _sink;
  id from = _source;
  if (from) [sink source:from needsKey:failures];
}

- (void)keepParameterSet:(NSData *__strong *)slot nal:(const uint8_t *)nal length:(size_t)length {
  if (length > kMaxParameterSet) return;
  NSData *fresh = [NSData dataWithBytes:nal length:length];
  if ([*slot isEqualToData:fresh]) return;
  *slot = fresh;
  _formatStale = YES;
}

- (BOOL)prepareSession {
  if (!_formatStale && _session) return YES;
  if (!_sps || !_pps || (self.hevc && !_vps)) return NO;
  const uint8_t *sets[3];
  size_t sizes[3];
  size_t count = 0;
  if (self.hevc) {
    sets[count] = _vps.bytes;
    sizes[count++] = _vps.length;
  }
  sets[count] = _sps.bytes;
  sizes[count++] = _sps.length;
  sets[count] = _pps.bytes;
  sizes[count++] = _pps.length;
  CMVideoFormatDescriptionRef format = NULL;
  OSStatus made = self.hevc ? CMVideoFormatDescriptionCreateFromHEVCParameterSets(NULL, count, sets, sizes, 4, NULL, &format)
                            : CMVideoFormatDescriptionCreateFromH264ParameterSets(NULL, count, sets, sizes, 4, &format);
  if (made != noErr) return NO;
  [self endSession];
  if (_format) CFRelease(_format);
  _format = format;
  _formatStale = NO;
  NSDictionary *spec = @{(id)kVTVideoDecoderSpecification_EnableHardwareAcceleratedVideoDecoder: @YES};
  NSDictionary *out = @{(id)kCVPixelBufferIOSurfacePropertiesKey: @{}};
  VTDecompressionOutputCallbackRecord callback = {onDecoded, (__bridge void *)self};
  if (VTDecompressionSessionCreate(NULL, _format, (__bridge CFDictionaryRef)spec, (__bridge CFDictionaryRef)out, &callback, &_session) != noErr) return NO;
  CFBooleanRef hardware = NULL;
  VTSessionCopyProperty(_session, kVTDecompressionPropertyKey_UsingHardwareAcceleratedVideoDecoder, NULL, &hardware);
  id<MVSink> sink = _sink;
  sink.stats.decoder = hardware == kCFBooleanTrue ? @"hardware" : @"software";
  _pixelsTold = NO;
  if (hardware) CFRelease(hardware);
  CMVideoDimensions size = CMVideoFormatDescriptionGetDimensions(_format);
  id from = _source;
  if (from) [sink source:from size:CGSizeMake(size.width, size.height) codec:self.hevc ? @"hevc" : @"h264"];
  return YES;
}

- (void)fail {
  os_unfair_lock_lock(&_lock);
  _awaitingKey = YES;
  int failures = ++_failures;
  os_unfair_lock_unlock(&_lock);
  id<MVSink> sink = _sink;
  [sink.stats dropped:1];
  [self askForKey:failures];
}

- (BOOL)decode:(const uint8_t *)data length:(size_t)length {
  NSMutableData *slices = [NSMutableData dataWithCapacity:length];
  __block BOOL key = NO;
  BOOL hevc = self.hevc;
  MVForEachNal(data, length, ^(const uint8_t *nal, size_t size) {
    NalKind kind = nalKind(nal, size, hevc);
    if (kind == NalVps) [self keepParameterSet:&self->_vps nal:nal length:size];
    if (kind == NalSps) [self keepParameterSet:&self->_sps nal:nal length:size];
    if (kind == NalPps) [self keepParameterSet:&self->_pps nal:nal length:size];
    if (kind != NalSlice && kind != NalKeySlice) return;
    if (kind == NalKeySlice) key = YES;
    uint32_t big = CFSwapInt32HostToBig((uint32_t)size);
    [slices appendBytes:&big length:4];
    [slices appendBytes:nal length:size];
  });
  if (!slices.length) return YES;
  id<MVSink> sink = _sink;
  os_unfair_lock_lock(&_lock);
  BOOL skip = _awaitingKey && !key;
  BOOL behind = !skip && !key && _inFlight >= kMaxInFlight;
  if (behind) _awaitingKey = YES;
  if (key) _awaitingKey = NO;
  os_unfair_lock_unlock(&_lock);
  MVRecorder *recorder = self.recorder;
  if ((skip || behind) && !recorder) {
    [sink.stats dropped:1];
    if (behind) [self askForKey:0];
    return NO;
  }
  if (![self prepareSession]) {
    if (key) [self fail];
    return NO;
  }
  void *copy = malloc(slices.length);
  memcpy(copy, slices.bytes, slices.length);
  CMBlockBufferRef block = NULL;
  CMSampleBufferRef sample = NULL;
  size_t size = slices.length;
  OSStatus status = CMBlockBufferCreateWithMemoryBlock(NULL, copy, size, kCFAllocatorMalloc, NULL, 0, size, 0, &block);
  if (status == noErr) status = CMSampleBufferCreateReady(NULL, block, _format, 1, 0, NULL, 1, &size, &sample);
  if (status == noErr && recorder) {
    [recorder append:sample format:_format key:key];
    if (recorder.wantsKey && MVNowMs() - _recorderAskedAt > kRecorderAskMs) {
      _recorderAskedAt = MVNowMs();
      [self askForKey:0];
    }
  }
  if (skip || behind) {
    // a movie goes on with what the picture cannot show yet
    [sink.stats dropped:1];
    if (behind) [self askForKey:0];
    if (sample) CFRelease(sample);
    if (block) CFRelease(block);
    return NO;
  }
  if (status == noErr) {
    double *startedAt = malloc(sizeof(double));
    *startedAt = MVNowMs();
    os_unfair_lock_lock(&_lock);
    _inFlight++;
    os_unfair_lock_unlock(&_lock);
    status = VTDecompressionSessionDecodeFrame(_session, sample, kVTDecodeFrame_EnableAsynchronousDecompression, startedAt, NULL);
    if (status != noErr) {
      os_unfair_lock_lock(&_lock);
      _inFlight--;
      os_unfair_lock_unlock(&_lock);
      free(startedAt);
    }
  }
  if (sample) CFRelease(sample);
  if (block) CFRelease(block);
  if (status != noErr) [self fail];
  return status == noErr;
}

- (void)finished:(OSStatus)status image:(CVImageBufferRef)image startedAt:(double)startedAt {
  os_unfair_lock_lock(&_lock);
  _inFlight--;
  BOOL closed = _closed;
  BOOL good = status == noErr && image;
  if (good) _failures = 0;
  BOOL show = good && !_awaitingKey && !closed;
  os_unfair_lock_unlock(&_lock);
  if (closed) return;
  if (!good) {
    [self fail];
    return;
  }
  id<MVSink> sink = _sink;
  [sink.stats decodedMs:MVNowMs() - startedAt];
  id from = _source;
  if (image && !_pixelsTold) {
    _pixelsTold = YES;
    OSType f = CFSwapInt32HostToBig(CVPixelBufferGetPixelFormatType(image));
    sink.stats.decoder = [NSString stringWithFormat:@"%@ %.4s", sink.stats.decoder, (const char *)&f];
  }
  if (show && from) [sink source:from image:image];
}

@end
