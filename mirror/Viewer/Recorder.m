// A stream's own frames into a movie, as they came: no second encode, so no cost in quality or in CPU. It starts at a key
// frame and ends at the first thing it cannot go past, keeping all it has: a full disk, or a picture that changes shape.
#import "Viewer.h"
#import <AVFoundation/AVFoundation.h>

static const int32_t kMicroseconds = 1000000;

@implementation MVRecorder {
  NSURL *_url;
  AVAssetWriter *_writer;
  AVAssetWriterInput *_input;
  CMFormatDescriptionRef _format;
  double _firstMs;
  int64_t _lastUs;
  long _frames, _dropped;
  BOOL _awaitingKey, _ended;
  NSString *_why;
  NSLock *_lock;
}

- (instancetype)initWithFile:(NSString *)file {
  if ((self = [super init])) {
    _url = [NSURL fileURLWithPath:file];
    _awaitingKey = YES;
    _lastUs = -1;
    _lock = [NSLock new];
  }
  return self;
}

- (void)dealloc {
  if (_format) CFRelease(_format);
}

- (BOOL)wantsKey {
  [_lock lock];
  BOOL wants = _awaitingKey && !_ended;
  [_lock unlock];
  return wants;
}

- (BOOL)open:(CMFormatDescriptionRef)format {
  NSError *error = nil;
  [NSFileManager.defaultManager removeItemAtURL:_url error:NULL];
  _writer = [AVAssetWriter assetWriterWithURL:_url fileType:AVFileTypeMPEG4 error:&error];
  if (!_writer) {
    _why = error.localizedDescription ?: @"the movie could not be made";
    return NO;
  }
  _input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:nil sourceFormatHint:format];
  _input.expectsMediaDataInRealTime = YES;
  if (![_writer canAddInput:_input]) {
    _why = @"a movie cannot hold this stream's frames";
    return NO;
  }
  [_writer addInput:_input];
  if (![_writer startWriting]) {
    _why = _writer.error.localizedDescription ?: @"the movie could not start";
    return NO;
  }
  [_writer startSessionAtSourceTime:kCMTimeZero];
  _format = (CMFormatDescriptionRef)CFRetain(format);
  _firstMs = MVNowMs();
  return YES;
}

- (void)append:(CMSampleBufferRef)sample format:(CMFormatDescriptionRef)format key:(BOOL)key {
  [_lock lock];
  [self appendLocked:sample format:format key:key];
  [_lock unlock];
}

- (void)appendLocked:(CMSampleBufferRef)sample format:(CMFormatDescriptionRef)format key:(BOOL)key {
  if (_ended) return;
  if (_awaitingKey && !key) return;
  if (!_writer && ![self open:format]) {
    _ended = YES;
    return;
  }
  if (_format && !CMFormatDescriptionEqual(_format, format)) {
    _why = @"the picture changed shape, so the movie ends here";
    _ended = YES;
    return;
  }
  if (_writer.status == AVAssetWriterStatusFailed) {
    _why = _writer.error.localizedDescription ?: @"the movie could not be written";
    _ended = YES;
    return;
  }
  if (!_input.readyForMoreMediaData) {
    // what follows needs this one: the next key frame is where it can go on from
    _dropped++;
    _awaitingKey = YES;
    return;
  }
  // arrival times, as the stream's own clock is not this Mac's; each later than the last
  int64_t us = (int64_t)((MVNowMs() - _firstMs) * 1000);
  if (us <= _lastUs) us = _lastUs + 1;
  CMSampleTimingInfo timing = {.duration = kCMTimeInvalid, .presentationTimeStamp = CMTimeMake(us, kMicroseconds), .decodeTimeStamp = kCMTimeInvalid};
  CMSampleBufferRef timed = NULL;
  if (CMSampleBufferCreateCopyWithNewTiming(NULL, sample, 1, &timing, &timed) != noErr) return;
  CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(timed, YES);
  if (attachments && CFArrayGetCount(attachments) > 0) {
    CFMutableDictionaryRef first = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
    CFDictionarySetValue(first, kCMSampleAttachmentKey_NotSync, key ? kCFBooleanFalse : kCFBooleanTrue);
  }
  if ([_input appendSampleBuffer:timed]) {
    _frames++;
    _lastUs = us;
    _awaitingKey = NO;
  } else {
    _why = _writer.error.localizedDescription ?: @"the movie could not be written";
    _ended = YES;
  }
  CFRelease(timed);
}

/// Ends the file, in this time at most, with what it holds. Safe twice.
- (NSDictionary *)finish {
  [_lock lock];
  _ended = YES;
  AVAssetWriter *writer = _writer;
  AVAssetWriterInput *input = _input;
  _writer = nil;
  _input = nil;
  [_lock unlock];
  NSMutableDictionary *told = [@{@"frames": @(_frames), @"dropped": @(_dropped), @"seconds": @(_lastUs > 0 ? _lastUs / 1e6 : 0)} mutableCopy];
  if (writer && writer.status == AVAssetWriterStatusWriting) {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [input markAsFinished];
    [writer finishWritingWithCompletionHandler:^{
      dispatch_semaphore_signal(done);
    }];
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    if (writer.status != AVAssetWriterStatusCompleted && !_why) _why = writer.error.localizedDescription ?: @"the movie did not finish";
  }
  if (_frames == 0 && !_why) _why = @"no key frame came, so nothing was recorded";
  if (_why) told[@"why"] = _why;
  return told;
}

@end
