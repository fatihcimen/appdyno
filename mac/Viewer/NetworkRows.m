// The rows of the Network pane's list: a request as its line, one still under way as that, and the requests of a
// host under its name, so that a long list reads by where it went.
#import "Place.h"
#import "Window.h"
#import "Words.h"

/// What a rule or the throttle did to a request, as the op says it, in a person's words.
static NSString *howWord(NSDictionary *e) {
  NSString *how = [e[@"how"] isKindOfClass:NSString.class] ? e[@"how"] : nil;
  if ([how isEqual:@"mocked"]) return MVWord(@"Mocked");
  if ([how isEqual:@"failed"]) return MVWord(@"Failed by a rule");
  if ([how isEqual:@"delayed"]) return MVWord(@"Delayed by a rule");
  if ([how isEqual:@"unmatched"]) return MVWord(@"Failed: no rule took it");
  if ([how isEqual:@"sent"]) return MVFormat(@"Sent to %@", @[[e[@"to"] description] ?: @""]);
  return [how isEqual:@"lost"] ? MVWord(@"Lost by the throttle") : nil;
}

/// A size in the Mac's language: the system's formatter says bytes in English whatever the window's language.
static NSString *sized(id bytes) {
  double n = [bytes doubleValue];
  if (n < 1000) return MVWord([NSString stringWithFormat:@"%.0f bytes", n]);
  return n < 1e6 ? [MVDecimal(n / 1e3) stringByAppendingString:@" KB"] : [MVDecimal(n / 1e6) stringByAppendingString:@" MB"];
}

/// How long a request has been under way, as a person says it.
static NSString *since(id ms) {
  double n = [ms doubleValue];
  return n < 10000 ? [NSString stringWithFormat:@"%.0f ms", n] : [NSString stringWithFormat:@"%.0f s", n / 1000];
}

NSString *MVNetworkFigures(NSDictionary *e) {
  if ([e[@"inFlight"] boolValue]) return MVFormat(@"In flight for %@", @[since(e[@"ms"])]);
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  if (e[@"status"]) [parts addObject:[e[@"status"] description]];
  if (e[@"ms"]) [parts addObject:[NSString stringWithFormat:@"%@ ms", e[@"ms"]]];
  if (e[@"packets"]) [parts addObject:MVWord([NSString stringWithFormat:@"%@ packets", e[@"packets"]])];
  if (e[@"bytes"]) [parts addObject:sized(e[@"bytes"])];
  if ([e[@"error"] length]) [parts addObject:MVFormat(@"Failed: %@", @[e[@"error"]])];
  if (howWord(e)) [parts addObject:howWord(e)];
  return [parts componentsJoinedByString:@" · "];
}

NSString *MVNetworkKey(NSDictionary *e, NSUInteger at) {
  return [e[@"id"] isKindOfClass:NSNumber.class] ? [e[@"id"] stringValue] : @(at).stringValue;
}

MVRow *MVNetworkRow(NSDictionary *e, NSUInteger at) {
  MVRow *row = [MVRow new];
  row.key = MVNetworkKey(e, at);
  row.detail = MVNetworkFigures(e);
  NSString *url = [e[@"url"] isKindOfClass:NSString.class] ? e[@"url"] : nil;
  if (!url) {
    row.title = [NSString stringWithFormat:@"%@ · %@", MVWord([e[@"direction"] description] ?: @""), MVSentence([e[@"host"] description] ?: @"")];
    row.symbol = @"chart.bar";
    return row;
  }
  // its host is the heading it stands under
  NSURL *parsed = [NSURL URLWithString:url];
  NSString *where = parsed.host ? (parsed.path.length ? parsed.path : @"/") : url;
  row.title = [NSString stringWithFormat:@"%@ %@", e[@"method"] ?: @"GET", where];
  row.help = url;
  BOOL failed = [e[@"error"] length] || [e[@"status"] integerValue] >= 400;
  // one under way has no answer yet, and one a rule took is no answer of the server's: each stands apart
  row.symbol = [e[@"inFlight"] boolValue] ? @"hourglass" : failed  ? @"exclamationmark.triangle.fill"
                                                       : e[@"how"] ? @"arrow.triangle.branch"
                                                                   : @"arrow.down.circle";
  if (failed) row.tint = MVRed();
  return row;
}

/// The host a row's request went to, with its port where it names one; nil for a count, which went to none.
static NSString *hostOf(MVRow *row) {
  NSURL *url = row.help ? [NSURL URLWithString:row.help] : nil;
  if (!url.host) return nil;
  return url.port ? [NSString stringWithFormat:@"%@:%@", url.host, url.port] : url.host;
}

NSArray<MVRow *> *MVNetworkGrouped(NSArray<MVRow *> *rows) {
  NSMutableArray<NSString *> *hosts = [NSMutableArray array];
  NSMutableDictionary<NSString *, NSMutableArray<MVRow *> *> *under = [NSMutableDictionary dictionary];
  NSMutableArray<MVRow *> *out = [NSMutableArray array];
  for (MVRow *row in rows) {
    NSString *host = hostOf(row);
    if (!host) {
      [out addObject:row];
      continue;
    }
    if (!under[host]) {
      under[host] = [NSMutableArray array];
      [hosts addObject:host];
    }
    [under[host] addObject:row];
  }
  // each host once, in the order its first request came
  for (NSString *host in hosts) {
    [out addObject:[MVRow headerNamed:host]];
    [out addObjectsFromArray:under[host]];
  }
  return out;
}
