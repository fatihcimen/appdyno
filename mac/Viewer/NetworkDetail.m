// One request of the Network pane whole, from the parts the parent gives: what the list says of it, what the session
// measured, and its headers and bodies where the capture kept them. The names of the parts are the window's own, in the
// Mac's language; what the app and the server sent stands as it was sent.
#import "Place.h"
#import "Window.h"
#import "Words.h"

NSString *MVNetworkTook(double ms) {
  if (ms < 1000) return [NSString stringWithFormat:@"%.0f ms", ms];
  if (ms < 10000) return [MVFigure(ms / 1000, 2) stringByAppendingString:@" s"];
  if (ms < 60000) return [MVFigure(ms / 1000, 1) stringByAppendingString:@" s"];
  return [MVFigure(ms / 60000, 1) stringByAppendingString:MVWord(@" min")];
}

/// Three figures at most: 61 B, 1.2 KB, 200 KB, 3.45 MB.
NSString *MVNetworkSize(double bytes) {
  if (bytes < 1000) return [NSString stringWithFormat:@"%.0f B", bytes];
  double n = bytes < 1e6 ? bytes / 1e3 : bytes / 1e6;
  return [NSString stringWithFormat:@"%@ %@", MVFigure(n, n < 10 ? 2 : n < 100 ? 1
                                                                               : 0),
                                    bytes < 1e6 ? @"KB" : @"MB"];
}

/// The phases the session measured, each by its name here, in the order they happen; one it had none of is left out.
NSArray<NSArray *> *MVNetworkPhases(NSDictionary *timings) {
  NSMutableArray<NSArray *> *phases = [NSMutableArray array];
  for (NSArray<NSString *> *one in @[@[@"dns", @"DNS"], @[@"connect", @"Connect"], @[@"tls", @"TLS"], @[@"wait", @"Wait"], @[@"receive", @"Receive"]]) {
    NSNumber *ms = [timings[one[0]] isKindOfClass:NSNumber.class] ? timings[one[0]] : nil;
    if (ms && ms.doubleValue >= 0) [phases addObject:@[MVWord(one[1]), ms]];
  }
  return phases;
}

/// What the session says of its connection, beside the phases.
NSString *MVNetworkConnection(NSDictionary *timings) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  if ([timings[@"proto"] isKindOfClass:NSString.class]) [parts addObject:timings[@"proto"]];
  [parts addObject:MVWord([timings[@"reused"] boolValue] ? @"Connection reused" : @"New connection")];
  if ([timings[@"wire"] doubleValue] > 0) [parts addObject:MVFormat(@"%@ on the wire", @[MVNetworkSize([timings[@"wire"] doubleValue])])];
  if ([timings[@"ip"] isKindOfClass:NSString.class]) [parts addObject:timings[@"ip"]];
  return [parts componentsJoinedByString:@" · "];
}

/// Why a request has no headers and bodies to show, where it has none.
NSString *_Nullable MVNetworkNotKept(NSDictionary *detail) {
  if ([detail[@"kept"] boolValue]) return nil;
  return MVWord([detail[@"request"][@"inFlight"] boolValue] ? @"It has not ended. Its headers and bodies are kept when it does." : @"Its headers and bodies were not kept. Start a capture with them kept to read them.");
}

static void addHeaders(NSMutableArray<NSString *> *lines, NSString *title, id headers) {
  [lines addObject:MVWord(title)];
  for (NSDictionary *header in [headers isKindOfClass:NSArray.class] ? headers : @[])
    if ([header isKindOfClass:NSDictionary.class]) [lines addObject:[NSString stringWithFormat:@"  %@: %@", header[@"name"], header[@"value"]]];
}

static void addBody(NSMutableArray<NSString *> *lines, NSString *title, id text, id size) {
  double bytes = [size isKindOfClass:NSNumber.class] ? [size doubleValue] : [text isKindOfClass:NSString.class] ? [text length]
                                                                                                                : 0;
  if ([text isKindOfClass:NSString.class]) {
    [lines addObject:[NSString stringWithFormat:@"%@ (%@)", MVWord(title), MVNetworkSize(bytes)]];
    [lines addObject:text];
  } else if (bytes > 0) [lines addObject:[NSString stringWithFormat:@"%@: %@", MVWord(title), MVFormat(@"%@, not text or not kept", @[MVNetworkSize(bytes)])]];
}

NSString *MVNetworkDetailText(NSDictionary *detail) {
  NSDictionary *e = [detail[@"request"] isKindOfClass:NSDictionary.class] ? detail[@"request"] : @{};
  NSDictionary *t = [detail[@"timings"] isKindOfClass:NSDictionary.class] ? detail[@"timings"] : nil;
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  [lines addObject:[NSString stringWithFormat:@"#%@ %@ %@", detail[@"id"], e[@"method"] ?: @"GET", e[@"url"] ?: @""]];
  [lines addObject:MVNetworkFigures(e)];
  if ([t[@"cache"] boolValue]) [lines addObject:MVWord(@"From the cache")];
  else if (t) {
    NSMutableArray<NSString *> *phases = [NSMutableArray array];
    for (NSArray *phase in MVNetworkPhases(t)) [phases addObject:[NSString stringWithFormat:@"%@ %@", phase[0], MVNetworkTook([phase[1] doubleValue])]];
    if (phases.count) [lines addObject:[phases componentsJoinedByString:@" · "]];
    [lines addObject:MVNetworkConnection(t)];
    [lines addObject:MVWord(@"Measured on the probe's own connection, not the app's")];
  }
  NSString *none = MVNetworkNotKept(detail);
  if (none) {
    [lines addObject:none];
    return [lines componentsJoinedByString:@"\n"];
  }
  addHeaders(lines, @"Request headers", detail[@"requestHeaders"]);
  addBody(lines, @"Request body", detail[@"requestBody"], detail[@"requestBodySize"]);
  addHeaders(lines, @"Response headers", detail[@"responseHeaders"]);
  addBody(lines, @"Response body", detail[@"responseBody"], detail[@"responseBodySize"]);
  return [lines componentsJoinedByString:@"\n"];
}
