// The hub's words in the Mac's language. There is no bundle to hold system string files: a viewer is compiled from loose
// sources on first use. English is the key, so that what the parent sends for a command line and a window alike needs no
// second name, and a word is looked up at the label that shows it: one the table has not got stands in English.
#import "Words.h"

static BOOL gTestTurkish;

static BOOL turkish(void) {
  static BOOL is;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    is = [NSLocale.preferredLanguages.firstObject hasPrefix:@"tr"];
  });
  return is || gTestTurkish;
}

void MVTestTurkish(BOOL on) {
  gTestTurkish = on;
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
    take(MVWordTableDevice, MVWordCountDevice);
    take(MVWordTablePanes, MVWordCountPanes);
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
    take(MVWordTableDevice, MVWordCountDevice);
    take(MVWordTablePanes, MVWordCountPanes);
    rows = all;
  });
  return rows;
}

/// Every row with a `%@`, by its English: a template whose values a caller puts in as they are.
static NSDictionary<NSString *, NSString *> *templates(void) {
  static NSDictionary *words;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSMutableDictionary *all = [NSMutableDictionary dictionary];
    void (^take)(const MVWordRow *, size_t) = ^(const MVWordRow *table, size_t count) {
      for (size_t i = 0; i < count; i++)
        if (strstr(table[i].en, "%@")) all[@(table[i].en)] = @(table[i].tr);
    };
    take(MVWordTable, MVWordCount);
    take(MVWordTableClients, MVWordCountClients);
    take(MVWordTableConnect, MVWordCountConnect);
    take(MVWordTableDevice, MVWordCountDevice);
    take(MVWordTablePanes, MVWordCountPanes);
    [all addEntriesFromDictionary:forms()];
    words = all;
  });
  return words;
}

static NSString *_Nullable patternFor(NSString *english, BOOL keep);

/// What a pattern's `%@` stood for, each in its Turkish place. Kept, a part stays as it came unless it has the shape of a
/// sentence of the table itself, such as a count: what an app or a device names is never turned into a word that looks
/// the same.
static NSString *filled(NSString *turkishWords, NSTextCheckingResult *found, NSString *english, BOOL keep) {
  NSMutableString *out = [turkishWords mutableCopy];
  for (NSUInteger i = 1; i < found.numberOfRanges; i++) {
    NSString *given = [english substringWithRange:[found rangeAtIndex:i]];
    NSString *part = keep ? patternFor(given, YES) : MVInTurkish(given);
    if (!part) part = given;
    NSString *named = [NSString stringWithFormat:@"%%%lu$@", (unsigned long)i];
    if ([out containsString:named]) [out replaceOccurrencesOfString:named withString:part options:0 range:NSMakeRange(0, out.length)];
    else [out replaceOccurrencesOfString:@"%@" withString:part options:0 range:NSMakeRange(0, out.length)];
  }
  return out;
}

static NSString *_Nullable patternFor(NSString *english, BOOL keep) {
  NSRange all = NSMakeRange(0, english.length);
  for (NSArray *row in patterns()) {
    NSTextCheckingResult *found = [row[0] firstMatchInString:english options:0 range:all];
    if (found) return filled(row[1], found, english, keep);
  }
  return nil;
}

/// A row's Turkish for the whole of it, by its words or by a pattern, or nil.
static NSString *_Nullable rowFor(NSString *english, BOOL keep) {
  return exact()[english] ?: patternFor(english, keep);
}

static NSString *say(NSString *english, BOOL keep) {
  if (!english.length) return english;
  NSString *whole = rowFor(english, keep);
  if (whole) return whole;
  // a source's note comes as a sentence goes on, and the table holds it as one begins
  NSRange first = [english rangeOfComposedCharacterSequenceAtIndex:0];
  NSString *head = [english substringWithRange:first];
  NSString *begun = [head isEqual:head.uppercaseString] ? nil : rowFor([head.uppercaseString stringByAppendingString:[english substringFromIndex:NSMaxRange(first)]], keep);
  if (begun) {
    NSRange its = [begun rangeOfComposedCharacterSequenceAtIndex:0];
    return [[[begun substringWithRange:its] lowercaseStringWithLocale:locale()] stringByAppendingString:[begun substringFromIndex:NSMaxRange(its)]];
  }
  // what is joined up is said a part at a time
  for (NSString *join in @[@" · ", @", "]) {
    NSArray<NSString *> *parts = [english componentsSeparatedByString:join];
    if (parts.count < 2) continue;
    NSMutableArray<NSString *> *said = [NSMutableArray array];
    for (NSString *part in parts) [said addObject:say(part, keep)];
    return [said componentsJoinedByString:join];
  }
  return english;
}

NSString *MVInTurkish(NSString *english) {
  return say(english, NO);
}

NSString *MVWord(NSString *english) {
  return turkish() ? MVInTurkish(english) : english;
}

NSString *MVSentence(NSString *english) {
  return turkish() ? say(english, YES) : english;
}

NSString *MVFormat(NSString *english, NSArray<NSString *> *values) {
  NSMutableString *out = [(turkish() ? templates()[english] ?: english : english) mutableCopy];
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
