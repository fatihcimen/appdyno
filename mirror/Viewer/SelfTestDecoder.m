// The self test of the decoder on a real stream of the phone's kind: a burst, and pictures of 4:4:4.
#import "SelfTest.h"
#import <AVFoundation/AVFoundation.h>
#import <VideoToolbox/VideoToolbox.h>

/// Whether the layer a window uses takes a picture of this kind; it needs no window to say so.
static void checkLayerTakes444(CVImageBufferRef _Nullable image) {
  if (!image) return MVSkip(@"4:4:4: the layer", @"no picture to show it");
  CMVideoFormatDescriptionRef format = NULL;
  CMVideoFormatDescriptionCreateForImageBuffer(NULL, image, &format);
  CMSampleTimingInfo timing = {.duration = kCMTimeInvalid, .presentationTimeStamp = kCMTimeZero, .decodeTimeStamp = kCMTimeInvalid};
  CMSampleBufferRef sample = NULL;
  CMSampleBufferCreateReadyWithImageBuffer(NULL, image, format, &timing, &sample);
  if (format) CFRelease(format);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  AVSampleBufferDisplayLayer *layer = [AVSampleBufferDisplayLayer layer];
  [layer enqueueSampleBuffer:sample];
  usleep(200000);
  MVCheck(@"4:4:4: the layer takes it", layer.status != AVQueuedSampleBufferRenderingStatusFailed, layer.error.description);
#pragma clang diagnostic pop
  if (sample) CFRelease(sample);
}

/// The fixture's frames, one by one: each VCL unit with what comes before it.
static void feed444(NSData *stream, MVDecoder *decoder, void (^beforePicture)(void)) {
  MVForEachNal(stream.bytes, stream.length, ^(const uint8_t *nal, size_t length) {
    uint8_t start[3] = {0, 0, 1};
    NSMutableData *unit = [NSMutableData dataWithBytes:start length:3];
    [unit appendBytes:nal length:length];
    if (((nal[0] >> 1) & 0x3f) < 32) beforePicture();
    [decoder decode:unit.bytes length:unit.length];
  });
}

/// A burst, as a stream's first frames or a busy Mac's catching up are: past what a decoder can hold a frame goes, and is
/// said to have, but what it already held was whole, and is shown. Those were thrown away, so a window stayed black.
static void checkBurst(NSData *stream) {
  MVTestSink *sink = [MVTestSink new];
  MVDecoder *decoder = [[MVDecoder alloc] initWithSink:sink from:sink];
  decoder.hevc = YES;
  __block int pictures = 0;
  feed444(stream, decoder, ^{
    decoder.capturedMs = ++pictures;
  });
  int dropped = 0;
  for (int i = 0; i < 300 && sink.images + dropped < pictures; i++) {
    dropped += [sink.stats.report[@"dropped"] intValue];
    usleep(10000);
  }
  [decoder close];
  MVCheck(@"decoder: a burst loses no picture it held, and says what it dropped", sink.images > 0 && sink.images + dropped == pictures, [NSString stringWithFormat:@"%d shown, %d dropped, of %d", sink.images, dropped, pictures]);
  MVCheck(@"decoder: with frames in flight each picture keeps the capture time it went in with", (int)sink.captured.count == sink.images, [NSString stringWithFormat:@"%lu times for %d pictures", (unsigned long)sink.captured.count, sink.images]);
}

void MVCheckHevc444(NSString *_Nullable fixtures) {
  NSString *file = [fixtures stringByAppendingPathComponent:@"hevc444.hevc"];
  NSData *stream = file ? [NSData dataWithContentsOfFile:file] : nil;
  if (!stream) return MVSkip(@"4:4:4", @"no fixture given");
  if (!VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)) return MVSkip(@"4:4:4", @"no hardware HEVC decoder on this Mac");
  checkBurst(stream);
  MVTestSink *sink = [MVTestSink new];
  MVDecoder *decoder = [[MVDecoder alloc] initWithSink:sink from:sink];
  decoder.hevc = YES;
  __block int pictures = 0;
  feed444(stream, decoder, ^{
    // what this check is after is each frame, and how fast a burst can go is the check below: a stream's frames come spaced
    [sink waitForImages:pictures - 2];
    pictures++;
  });
  BOOL decoded = [sink waitForImages:pictures];
  MVCheck(@"4:4:4: every frame decoded", pictures > 0 && decoded, [NSString stringWithFormat:@"%d of %d", sink.images, pictures]);
  OSType format = sink.lastFormat;
  BOOL full = format == kCVPixelFormatType_444YpCbCr8BiPlanarVideoRange || format == kCVPixelFormatType_444YpCbCr8BiPlanarFullRange || format == kCVPixelFormatType_444YpCbCr10BiPlanarVideoRange || format == kCVPixelFormatType_444YpCbCr10BiPlanarFullRange;
  MVCheck(@"4:4:4: stays 4:4:4 out of the decoder", full, [NSString stringWithFormat:@"%c%c%c%c", (char)(format >> 24), (char)(format >> 16), (char)(format >> 8), (char)format]);
  [decoder close];
  checkLayerTakes444((__bridge CVImageBufferRef)sink.lastImage);
}
