// A Mac program that reads the words of one image with the system's Vision: what a screen with no tree, a game or a
// canvas, still shows. Words are { text, x, y, w, h, confidence }, in fractions of the image from its top left corner.
// Nothing leaves this Mac.
//
// TextScan <image>: the fast level, answered on stdout, in a fraction of a second. It reads Latin letters only.
// TextScan <image> <folder> <key> <seconds>: the accurate level, in a process of its own, which any language takes. It
// waits on the system's Neural Engine compiler, by program and by picture, for a minute or four, and a kill throws that
// work away: so nothing here waits for it. Its words go to <folder>/accurate.json under <key>, and what starts it clears
// up after it. The image goes as soon as it is read.
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <unistd.h>

static NSArray *wordsOf(NSData *image, VNRequestTextRecognitionLevel level, NSError **error) {
  VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
  request.recognitionLevel = level;
  // a screen's words are labels, not prose: a correction would rewrite a name
  request.usesLanguageCorrection = NO;
  if (level == VNRequestTextRecognitionLevelAccurate) request.automaticallyDetectsLanguage = YES;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithData:image options:@{}];
  if (![handler performRequests:@[ request ] error:error]) return nil;
  NSMutableArray *found = [NSMutableArray array];
  for (VNRecognizedTextObservation *o in request.results) {
    VNRecognizedText *best = [o topCandidates:1].firstObject;
    if (!best) continue;
    // Vision's origin is the bottom left corner
    CGRect b = o.boundingBox;
    [found addObject:@{
      @"text": best.string,
      @"x": @(b.origin.x),
      @"y": @(1 - b.origin.y - b.size.height),
      @"w": @(b.size.width),
      @"h": @(b.size.height),
      @"confidence": @(best.confidence),
    }];
  }
  return found;
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 2 && argc != 5) {
      fprintf(stderr, "usage: TextScan <image> [<folder> <key> <seconds>]\n");
      return 2;
    }
    NSData *image = [NSData dataWithContentsOfFile:@(argv[1])];
    NSError *error = nil;
    if (argc == 5) {
      unlink(argv[1]);
      alarm((unsigned)atoi(argv[4]));
      NSArray *found = wordsOf(image, VNRequestTextRecognitionLevelAccurate, &error);
      if (found)
        [[NSJSONSerialization dataWithJSONObject:@{@"key": @(argv[3]), @"words": found} options:0 error:NULL]
            writeToFile:[@(argv[2]) stringByAppendingPathComponent:@"accurate.json"]
             atomically:YES];
      return found ? 0 : 1;
    }
    NSArray *found = wordsOf(image, VNRequestTextRecognitionLevelFast, &error);
    if (!found) {
      fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
      return 1;
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:found options:0 error:NULL];
    fwrite(json.bytes, 1, json.length, stdout);
  }
  return 0;
}
