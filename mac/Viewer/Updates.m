// What a look for a release found, in a person's words: the app's own process and the hub's window say it alike.
#import "Updates.h"
#import "Words.h"

/// What follows `label` on its line.
static NSString *_Nullable lineOf(NSArray<NSString *> *lines, NSString *label) {
  for (NSString *line in lines)
    if ([line hasPrefix:label]) return [line substringFromIndex:label.length];
  return nil;
}

NSDictionary<NSString *, NSString *> *MVUpdateWords(NSString *said) {
  NSArray<NSString *> *lines = [said componentsSeparatedByString:@"\n"];
  NSString *have = [lineOf(lines, @"installed: ") componentsSeparatedByString:@","].firstObject, *latest = lineOf(lines, @"latest: ");
  // a refusal says its code last, which is no word of a person's
  NSString *raw = lineOf(lines, @"would refuse: ");
  NSString *refused = [raw stringByReplacingOccurrencesOfString:@" \\([A-Z_]+\\)$" withString:@"" options:NSRegularExpressionSearch range:NSMakeRange(0, raw.length)];
  // what it would do, which is to download the app's image, or to verify a package and upgrade it
  if (latest && !refused && lineOf(lines, @"would ")) return @{@"title": MVFormat(@"Appdyno %@ is available", @[latest]),
                                                               @"text": MVFormat(@"You have %@. It is downloaded and checked, then Appdyno opens again.", @[have ?: @"?"]),
                                                               @"offer": latest};
  if (have && lineOf(lines, @"nothing to do: ")) return @{@"title": MVWord(@"You're up to date"),
                                                          @"text": MVFormat(@"Appdyno %@ is the newest version.", @[have])};
  if (refused) {
    NSUInteger at = [lines indexOfObjectPassingTest:^BOOL(NSString *line, __unused NSUInteger i, __unused BOOL *stop) {
      return [line hasPrefix:@"would refuse: "];
    }];
    NSString *hint = at + 1 < lines.count ? [lines[at + 1] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet] : @"";
    // a refusal comes only where a newer release is out: it is said once, as an offer is
    return @{@"latest": latest ?: @"", @"title": MVWord(@"Appdyno cannot update itself here"), @"text": [NSString stringWithFormat:@"%@.\n%@.", MVCapitalized(MVSentence(refused)), MVCapitalized(MVSentence(hint))]};
  }
  return @{@"title": MVWord(@"Updates could not be checked"), @"text": said.length ? said : MVWord(@"appdyno gave no answer.")};
}
