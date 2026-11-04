// A Mac program that reads the words of one image with the system's Vision: what a screen with no tree, a game or a
// canvas, still shows. Answers a JSON array of { text, x, y, w, h, confidence } on stdout, in fractions of the image
// from its top left corner. Nothing leaves this Mac.
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 2) {
      fprintf(stderr, "usage: TextScan <image>\n");
      return 2;
    }
    VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    // a screen's words are labels, not prose: a correction would rewrite a name
    request.usesLanguageCorrection = NO;
    request.automaticallyDetectsLanguage = YES;
    NSURL *image = [NSURL fileURLWithPath:@(argv[1])];
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:image options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[ request ] error:&error]) {
      fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
      return 1;
    }
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
    NSData *json = [NSJSONSerialization dataWithJSONObject:found options:0 error:NULL];
    fwrite(json.bytes, 1, json.length, stdout);
  }
  return 0;
}
