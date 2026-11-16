// The rows of the Network pane's list: a request on one line, its mark, its status, its method, its path and how long it
// took; one still under way as that; and the requests of a host under its name, so that a long list reads by where it
// went. Colour sits in the mark alone, and the mark's shape says the same without it: a circle is the app's fault, a
// triangle the server's, a slash one that never arrived, a diamond a rule's doing.
#import "Place.h"
#import "Window.h"
#import "Words.h"

/// What a rule or the throttle did to a request, by the op's word for it; nil where neither did anything.
static NSString *howEnglish(NSDictionary *e) {
  NSString *how = [e[@"how"] isKindOfClass:NSString.class] ? e[@"how"] : nil;
  return @{@"mocked": @"Mocked", @"failed": @"Failed by a rule", @"delayed": @"Delayed by a rule", @"unmatched": @"Failed: no rule took it", @"sent": @"Sent to %@", @"lost": @"Lost by the throttle"}[how ?: @""];
}

/// The same in a person's words.
static NSString *howWord(NSDictionary *e) {
  NSString *english = howEnglish(e);
  if (!english) return nil;
  return [english containsString:@"%@"] ? MVFormat(english, @[[e[@"to"] description] ?: @""]) : MVWord(english);
}

/// Whether a rule or the throttle ended it with no answer: nothing came back, and none of it is the server's.
static BOOL endedHere(NSDictionary *e) {
  return [@[@"failed", @"unmatched", @"lost"] containsObject:e[@"how"] ?: @""];
}

BOOL MVNetworkFailed(NSDictionary *e) {
  return ![e[@"how"] isKindOfClass:NSString.class] && ([e[@"error"] length] || [e[@"status"] integerValue] >= 400);
}

/// How long a request took, or has been under way: one decimal while it ticks, so that the figure does not flicker.
static NSString *took(NSDictionary *e) {
  if (!e[@"ms"]) return nil;
  double ms = [e[@"ms"] doubleValue];
  if ([e[@"inFlight"] boolValue] && ms < 60000) return [MVFigure(ms / 1000, 1) stringByAppendingString:@" s"];
  return MVNetworkTook(ms);
}

NSString *MVNetworkFigures(NSDictionary *e) {
  if ([e[@"inFlight"] boolValue]) return MVFormat(@"In flight for %@", @[took(e) ?: @""]);
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  BOOL here = endedHere(e);
  // one a rule or the throttle ended has no status, no time and no size of its own: only what was done to it
  if ([e[@"status"] integerValue] > 0) [parts addObject:[e[@"status"] description]];
  if (e[@"ms"] && !here) [parts addObject:took(e)];
  if (e[@"packets"]) [parts addObject:MVWord([NSString stringWithFormat:@"%@ packets", e[@"packets"]])];
  if (e[@"bytes"] && !here && ([e[@"bytes"] doubleValue] > 0 || !e[@"url"])) [parts addObject:MVNetworkSize([e[@"bytes"] doubleValue])];
  if ([e[@"error"] length] && !here) [parts addObject:MVFormat(@"Failed: %@", @[e[@"error"]])];
  if (howWord(e)) [parts addObject:howWord(e)];
  return [parts componentsJoinedByString:@" · "];
}

NSString *MVNetworkKey(NSDictionary *e, NSUInteger at) {
  return [e[@"id"] isKindOfClass:NSNumber.class] ? [e[@"id"] stringValue] : @(at).stringValue;
}

/// The mark of how a request stands, and its colour: none for the dull majority that went well.
static void mark(MVRow *row, NSDictionary *e) {
  NSInteger status = [e[@"status"] integerValue];
  NSString *how = [e[@"how"] isKindOfClass:NSString.class] ? e[@"how"] : nil;
  if ([e[@"inFlight"] boolValue]) {
    // motion alone says it is under way, and an hourglass for a person who asked for less motion
    row.symbol = @"hourglass";
    row.spins = YES;
  } else if ([how isEqual:@"lost"]) {
    row.symbol = @"tortoise.fill";
  } else if (how) {
    row.symbol = endedHere(e) ? @"xmark.diamond.fill" : @"arrow.triangle.turn.up.right.diamond.fill";
    row.tint = MVAgent();
  } else if ([e[@"error"] length]) {
    row.symbol = @"wifi.slash";
    row.tint = MVMarkRed();
  } else if (status >= 500) {
    row.symbol = @"exclamationmark.triangle.fill";
    row.tint = MVMarkRed();
  } else if (status >= 400) {
    row.symbol = @"exclamationmark.circle.fill";
    row.tint = MVOrange();
  } else if (status >= 300) {
    row.symbol = @"arrow.turn.down.right";
  }
}

MVRow *MVNetworkRow(NSDictionary *e, NSUInteger at) {
  MVRow *row = [MVRow new];
  row.key = MVNetworkKey(e, at);
  row.detail = MVNetworkFigures(e);
  NSString *url = [e[@"url"] isKindOfClass:NSString.class] ? e[@"url"] : nil;
  if (!url) {
    row.title = [NSString stringWithFormat:@"%@ · %@", MVWord([e[@"direction"] description] ?: @""), MVSentence([e[@"host"] description] ?: @"")];
    row.symbol = @"chart.bar";
    row.ends = row.detail;
    return row;
  }
  // its host is the heading it stands under
  NSURL *parsed = [NSURL URLWithString:url];
  NSString *where = parsed.host ? (parsed.path.length ? parsed.path : @"/") : url;
  row.method = [e[@"method"] description] ?: @"GET";
  row.title = [NSString stringWithFormat:@"%@ %@", row.method, where];
  row.line = where;
  row.help = [NSString stringWithFormat:@"#%@ %@", row.key, url];
  NSInteger status = [e[@"status"] integerValue];
  BOOL here = endedHere(e), flying = [e[@"inFlight"] boolValue];
  row.bad = MVNetworkFailed(e);
  if (status > 0) row.code = @(status).stringValue;
  row.strong = status >= 400 || [e[@"how"] isKindOfClass:NSString.class];
  // one that never had an answer has no time of its own to show
  row.ends = here || (!flying && [e[@"error"] length] && status == 0) ? @"—" : took(e);
  mark(row, e);
  // the op's own words for how a request stands, in English and in Turkish whatever the window speaks: a person
  // types `failed`, `başarısız`, `5xx` or `mocked` as an agent's `status` takes them, and `#12` for the request an agent named
  NSMutableArray<NSString *> *finds = [NSMutableArray arrayWithObjects:url, [@"#" stringByAppendingString:row.key], nil];
  if (status >= 100) [finds addObject:[NSString stringWithFormat:@"%ldxx", (long)(status / 100)]];
  for (NSString *word in @[row.bad ? @"failed" : @"", flying ? @"in flight" : @"", [e[@"how"] isKindOfClass:NSString.class] ? e[@"how"] : @""])
    if (word.length) [finds addObjectsFromArray:@[word, MVInTurkish(word)]];
  row.finds = [finds componentsJoinedByString:@" "];
  // what a screen reader says of the row: how it stands in words, as its mark is no word
  NSMutableArray<NSString *> *says = [NSMutableArray arrayWithObject:row.title];
  if (row.bad) [says addObject:MVWord(@"failed")];
  if (row.detail.length) [says addObject:[row.detail stringByReplacingOccurrencesOfString:@" · " withString:@", "]];
  row.says = [says componentsJoinedByString:@", "];
  return row;
}

/// The host a row's request went to, with its port where it names one; nil for a count, which went to none.
static NSString *hostOf(MVRow *row) {
  NSRange space = [row.help ?: @"" rangeOfString:@" "];
  NSURL *url = space.location == NSNotFound ? nil : [NSURL URLWithString:[row.help substringFromIndex:space.location + 1]];
  if (!url.host) return nil;
  return url.port ? [NSString stringWithFormat:@"%@:%@", url.host, url.port] : url.host;
}

NSArray<MVRow *> *MVNetworkGrouped(NSArray<MVRow *> *rows, NSSet<NSString *> *_Nullable closed) {
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
  // each host once, in the order its first request came, with how many it has and how many of them failed
  for (NSString *host in hosts) {
    MVRow *head = [MVRow headerNamed:host];
    NSRange colon = [host rangeOfString:@":" options:NSBackwardsSearch];
    head.key = [@"host " stringByAppendingString:host];
    head.line = colon.location == NSNotFound ? host : [host substringToIndex:colon.location];
    head.ends = colon.location == NSNotFound ? nil : [host substringFromIndex:colon.location];
    head.count = under[host].count;
    head.failed = [under[host] filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"bad == YES"]].count;
    head.closed = [closed containsObject:host];
    head.finds = host;
    NSString *counted = MVFormat(head.count == 1 ? @"%@ request" : @"%@ requests", @[MVCount(head.count)]);
    head.says = head.failed ? [NSString stringWithFormat:@"%@, %@, %@", host, counted, MVFormat(@"%@ failed", @[MVCount(head.failed)])] : [NSString stringWithFormat:@"%@, %@", host, counted];
    [out addObject:head];
    if (!head.closed) [out addObjectsFromArray:under[host]];
  }
  return out;
}
