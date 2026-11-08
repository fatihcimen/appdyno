// The hub's words in the Mac's language. There is no bundle to hold system string files: a viewer is compiled from loose
// sources on first use. English is the key, so that what the parent sends for a command line and a window alike needs no
// second name, and a word is looked up at the label that shows it: one the table has not got stands in English.
#import "Words.h"

static BOOL turkish(void) {
  static BOOL is;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    is = [NSLocale.preferredLanguages.firstObject hasPrefix:@"tr"];
  });
  return is;
}

static NSLocale *locale(void) {
  return [NSLocale localeWithLocaleIdentifier:turkish() ? @"tr_TR" : @"en_US"];
}

/// What has no `%@` is found at once; what has one is a pattern, in the table's order, so a longer row may stand first.
static NSDictionary<NSString *, NSString *> *exact(void) {
  static NSDictionary *words;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSMutableDictionary *all = [NSMutableDictionary dictionary];
    void (^take)(const MVWordRow *, size_t) = ^(const MVWordRow *table, size_t count) {
      for (size_t i = 0; i < count; i++)
        if (!strstr(table[i].en, "%@")) all[@(table[i].en)] = @(table[i].tr);
    };
    take(MVWordTable, MVWordCount);
    take(MVWordTableClients, MVWordCountClients);
    take(MVWordTableHelp, MVWordCountHelp);
    take(MVWordTableConnect, MVWordCountConnect);
    words = all;
  });
  return words;
}

/// Help's rows with a `%@` are filled by name and are no patterns: its "On %@" must take no line that merely begins so.
static NSDictionary<NSString *, NSString *> *forms(void) {
  static NSDictionary *words;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSMutableDictionary *all = [NSMutableDictionary dictionary];
    for (size_t i = 0; i < MVWordCountHelp; i++)
      if (strstr(MVWordTableHelp[i].en, "%@")) all[@(MVWordTableHelp[i].en)] = @(MVWordTableHelp[i].tr);
    words = all;
  });
  return words;
}

static NSArray<NSArray *> *patterns(void) {
  static NSArray *rows;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSMutableArray *all = [NSMutableArray array];
    void (^take)(const MVWordRow *, size_t) = ^(const MVWordRow *table, size_t count) {
      for (size_t i = 0; i < count; i++) {
        if (!strstr(table[i].en, "%@")) continue;
        NSString *escaped = [NSRegularExpression escapedPatternForString:@(table[i].en)];
        NSString *shape = [NSString stringWithFormat:@"^%@$", [escaped stringByReplacingOccurrencesOfString:@"%@" withString:@"([^,·]+?)"]];
        NSRegularExpression *english = [NSRegularExpression regularExpressionWithPattern:shape options:0 error:NULL];
        if (english) [all addObject:@[english, @(table[i].tr)]];
      }
    };
    take(MVWordTable, MVWordCount);
    take(MVWordTableClients, MVWordCountClients);
    take(MVWordTableConnect, MVWordCountConnect);
    rows = all;
  });
  return rows;
}

/// What a pattern's `%@` stood for, each in its Turkish place.
static NSString *filled(NSString *turkishWords, NSTextCheckingResult *found, NSString *english) {
  NSMutableString *out = [turkishWords mutableCopy];
  for (NSUInteger i = 1; i < found.numberOfRanges; i++) {
    NSString *part = MVInTurkish([english substringWithRange:[found rangeAtIndex:i]]);
    NSString *named = [NSString stringWithFormat:@"%%%lu$@", (unsigned long)i];
    if ([out containsString:named]) [out replaceOccurrencesOfString:named withString:part options:0 range:NSMakeRange(0, out.length)];
    else [out replaceOccurrencesOfString:@"%@" withString:part options:0 range:NSMakeRange(0, out.length)];
  }
  return out;
}

NSString *MVInTurkish(NSString *english) {
  if (!english.length) return english;
  NSString *known = exact()[english];
  if (known) return known;
  NSRange all = NSMakeRange(0, english.length);
  for (NSArray *row in patterns()) {
    NSTextCheckingResult *found = [row[0] firstMatchInString:english options:0 range:all];
    if (found) return filled(row[1], found, english);
  }
  // what is joined up is said a part at a time
  for (NSString *join in @[@" · ", @", "]) {
    NSArray<NSString *> *parts = [english componentsSeparatedByString:join];
    if (parts.count < 2) continue;
    NSMutableArray<NSString *> *said = [NSMutableArray array];
    for (NSString *part in parts) [said addObject:MVInTurkish(part)];
    return [said componentsJoinedByString:join];
  }
  return english;
}

NSString *MVWord(NSString *english) {
  return turkish() ? MVInTurkish(english) : english;
}

NSString *MVFormat(NSString *english, NSArray<NSString *> *values) {
  NSMutableString *out = [(turkish() ? forms()[english] ?: english : english) mutableCopy];
  [values enumerateObjectsUsingBlock:^(NSString *value, NSUInteger at, __unused BOOL *stop) {
    NSRange place = [out rangeOfString:[NSString stringWithFormat:@"%%%lu$@", (unsigned long)at + 1]];
    if (place.location == NSNotFound) place = [out rangeOfString:@"%@"];
    if (place.location != NSNotFound) [out replaceCharactersInRange:place withString:value];
  }];
  return out;
}

NSString *MVDecimal(double value) {
  return [[NSString alloc] initWithFormat:@"%.1f" locale:locale(), value];
}

NSString *MVPercent(double value) {
  NSString *number = value == round(value) ? [NSString stringWithFormat:@"%.0f", value] : MVDecimal(value);
  return turkish() ? [@"%" stringByAppendingString:number] : [number stringByAppendingString:@" %"];
}
