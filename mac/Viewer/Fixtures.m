// Encoded test frames, made on the spot by VideoToolbox: the self test and a stand-in agent need a real
// stream, and no binary needs to be kept for it.
#import "SelfTest.h"

@implementation MVTestFrame
@end

static void fillFrame(CVPixelBufferRef buffer, int index) {
  CVPixelBufferLockBaseAddress(buffer, 0);
  uint8_t *base = CVPixelBufferGetBaseAddress(buffer);
  size_t stride = CVPixelBufferGetBytesPerRow(buffer), w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer);
  for (size_t y = 0; y < h; y++) {
    uint8_t *row = base + y * stride;
    for (size_t x = 0; x < w; x++) {
      BOOL bar = ((x + (size_t)index * 8) / 32) % 2 == 0;
      row[x * 4] = bar ? 240 : 30;
      row[x * 4 + 1] = (uint8_t)(y * 255 / h);
      row[x * 4 + 2] = (uint8_t)(index * 9);
      row[x * 4 + 3] = 255;
    }
  }
  CVPixelBufferUnlockBaseAddress(buffer, 0);
}

static void appendStart(NSMutableData *to, const void *bytes, size_t length) {
  static const uint8_t start[4] = {0, 0, 0, 1};
  [to appendBytes:start length:4];
  [to appendBytes:bytes length:length];
}

static void appendParameterSets(NSMutableData *to, CMFormatDescriptionRef format, BOOL hevc) {
  size_t count = 0;
  const uint8_t *set;
  size_t size;
  if (hevc) CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(format, 0, NULL, NULL, &count, NULL);
  else CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, 0, NULL, NULL, &count, NULL);
  for (size_t i = 0; i < count; i++) {
    OSStatus status = hevc ? CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(format, i, &set, &size, NULL, NULL)
                           : CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, i, &set, &size, NULL, NULL);
    if (status == noErr) appendStart(to, set, size);
  }
}

static void onEncoded(void *refcon, __unused void *source, OSStatus status, __unused VTEncodeInfoFlags flags, CMSampleBufferRef sample) {
  if (status != noErr || !sample) return;
  NSMutableArray<MVTestFrame *> *frames = (__bridge NSMutableArray *)refcon;
  CFDictionaryRef attachment = CFArrayGetValueAtIndex(CMSampleBufferGetSampleAttachmentsArray(sample, YES), 0);
  BOOL key = !CFDictionaryContainsKey(attachment, kCMSampleAttachmentKey_NotSync);
  CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sample);
  BOOL hevc = CMFormatDescriptionGetMediaSubType(format) == kCMVideoCodecType_HEVC;
  NSMutableData *annexB = [NSMutableData data];
  if (key) appendParameterSets(annexB, format, hevc);
  CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample);
  size_t total = 0;
  char *bytes = NULL;
  if (CMBlockBufferGetDataPointer(block, 0, NULL, &total, &bytes) != noErr) return;
  for (size_t at = 0; at + 4 <= total;) {
    uint32_t big;
    memcpy(&big, bytes + at, 4);
    size_t length = CFSwapInt32BigToHost(big);
    if (at + 4 + length > total) break;
    appendStart(annexB, bytes + at + 4, length);
    at += 4 + length;
  }
  MVTestFrame *frame = [MVTestFrame new];
  frame.data = annexB;
  frame.key = key;
  @synchronized(frames) {
    [frames addObject:frame];
  }
}

NSArray<MVTestFrame *> *MVEncodeFrames(BOOL hevc, int count, int keyEvery) {
  NSMutableArray<MVTestFrame *> *frames = [NSMutableArray array];
  const int w = 320, h = 240;
  VTCompressionSessionRef session = NULL;
  OSStatus status = VTCompressionSessionCreate(NULL, w, h, hevc ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264, NULL, NULL, NULL, onEncoded, (__bridge void *)frames, &session);
  if (status != noErr) return nil;
  VTSessionSetProperty(session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
  VTSessionSetProperty(session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
  VTSessionSetProperty(session, kVTCompressionPropertyKey_MaxKeyFrameInterval, (__bridge CFNumberRef) @(keyEvery));
  CVPixelBufferRef buffer = NULL;
  NSDictionary *attributes = @{(id)kCVPixelBufferIOSurfacePropertiesKey: @{}};
  CVPixelBufferCreate(NULL, w, h, kCVPixelFormatType_32BGRA, (__bridge CFDictionaryRef)attributes, &buffer);
  for (int i = 0; i < count && buffer; i++) {
    fillFrame(buffer, i);
    VTCompressionSessionEncodeFrame(session, buffer, CMTimeMake(i, 30), kCMTimeInvalid, NULL, NULL, NULL);
  }
  VTCompressionSessionCompleteFrames(session, kCMTimeInvalid);
  VTCompressionSessionInvalidate(session);
  CFRelease(session);
  if (buffer) CVPixelBufferRelease(buffer);
  return frames.count ? frames : nil;
}

int MVEncodeFixture(NSString *codec, int count) {
  NSArray<MVTestFrame *> *frames = MVEncodeFrames([codec isEqual:@"hevc"], count, 10);
  if (!frames) return 1;
  for (MVTestFrame *frame in frames) {
    uint32_t big = CFSwapInt32HostToBig((uint32_t)frame.data.length);
    uint8_t key = frame.key;
    fwrite(&big, 4, 1, stdout);
    fwrite(&key, 1, 1, stdout);
    fwrite(frame.data.bytes, 1, frame.data.length, stdout);
  }
  fflush(stdout);
  return 0;
}
