// What a request's detail sets in its well: headers as names and values, and a body as it was sent, set out to be read
// where it is JSON. One colour beside the inks: a key and a string are the main ink, the marks between them quiet,
// a number, true, false and null the accent, and a value that was hidden quiet too. Nothing is parsed into objects and
// written again, so a body keeps the order of its keys and every character it came with.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kLine = 16, kNames = 104;

static NSFont *mono(void) {
  return [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
}

static NSDictionary *inked(NSColor *color, NSParagraphStyle *_Nullable set) {
  return set ? @{NSFontAttributeName: mono(), NSForegroundColorAttributeName: color, NSParagraphStyleAttributeName: set} : @{NSFontAttributeName: mono(), NSForegroundColorAttributeName: color};
}

/// Whether text is a JSON object or array, by how it starts and ends: what is neither is shown as it came.
static BOOL looksJson(NSString *text) {
  NSString *trimmed = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (trimmed.length < 2) return NO;
  unichar first = [trimmed characterAtIndex:0], last = [trimmed characterAtIndex:trimmed.length - 1];
  return (first == '{' && last == '}') || (first == '[' && last == ']');
}

NSString *MVNetworkBodyKind(NSString *text) {
  return looksJson(text) ? @"JSON" : MVWord(@"Text");
}

/// JSON one value to a line, two spaces in for each level, in its colours.
static NSAttributedString *jsonSetOut(NSString *text) {
  NSMutableAttributedString *out = [NSMutableAttributedString new];
  NSMutableParagraphStyle *set = [NSMutableParagraphStyle new];
  set.minimumLineHeight = set.maximumLineHeight = kLine;
  set.lineBreakMode = NSLineBreakByCharWrapping;
  NSDictionary *ink = inked(MVInkColor(), set), *quiet = inked(MVQuietColor(), set), *accent = inked(MVAccent(), set);
  void (^add)(NSString *, NSDictionary *) = ^(NSString *s, NSDictionary *how) {
    [out appendAttributedString:[[NSAttributedString alloc] initWithString:s attributes:how]];
  };
  NSUInteger depth = 0, n = text.length;
  NSString * (^line)(NSUInteger) = ^(NSUInteger level) {
    return [@"\n" stringByPaddingToLength:1 + 2 * level withString:@" " startingAtIndex:0];
  };
  for (NSUInteger i = 0; i < n; i++) {
    unichar c = [text characterAtIndex:i];
    if (c == '"') {
      NSUInteger end = i + 1;
      while (end < n && [text characterAtIndex:end] != '"') end += [text characterAtIndex:end] == '\\' ? 2 : 1;
      NSString *string = [text substringWithRange:NSMakeRange(i, MIN(end, n - 1) - i + 1)];
      // a value hidden by the tool, as it hides one everywhere
      add(string, [string isEqual:@"\"•••\""] ? quiet : ink);
      i = MIN(end, n - 1);
    } else if (c == '{' || c == '[') {
      NSUInteger next = i + 1;
      while (next < n && [NSCharacterSet.whitespaceAndNewlineCharacterSet characterIsMember:[text characterAtIndex:next]]) next++;
      BOOL empty = next < n && [text characterAtIndex:next] == (c == '{' ? '}' : ']');
      add([NSString stringWithCharacters:&c length:1], quiet);
      if (empty) {
        unichar close = [text characterAtIndex:next];
        add([NSString stringWithCharacters:&close length:1], quiet);
        i = next;
      } else add(line(++depth), quiet);
    } else if (c == '}' || c == ']') {
      depth = depth ? depth - 1 : 0;
      add(line(depth), quiet);
      add([NSString stringWithCharacters:&c length:1], quiet);
    } else if (c == ',') {
      add(@",", quiet);
      add(line(depth), quiet);
    } else if (c == ':') {
      add(@": ", quiet);
    } else if (![NSCharacterSet.whitespaceAndNewlineCharacterSet characterIsMember:c]) {
      NSUInteger end = i;
      while (end < n && ![@",}] \n\r\t" containsString:[text substringWithRange:NSMakeRange(end, 1)]]) end++;
      add([text substringWithRange:NSMakeRange(i, end - i)], accent);
      i = end - 1;
    }
  }
  return out;
}

NSAttributedString *MVNetworkBodyText(NSString *text) {
  if (looksJson(text)) return jsonSetOut(text);
  NSMutableParagraphStyle *set = [NSMutableParagraphStyle new];
  set.minimumLineHeight = set.maximumLineHeight = kLine;
  return [[NSAttributedString alloc] initWithString:text attributes:inked(MVInkColor(), set)];
}

NSAttributedString *MVNetworkHeadersText(NSArray<NSArray *> *groups) {
  NSMutableAttributedString *out = [NSMutableAttributedString new];
  NSMutableParagraphStyle *set = [NSMutableParagraphStyle new];
  set.minimumLineHeight = kLine;
  set.tabStops = @[[[NSTextTab alloc] initWithTextAlignment:NSTextAlignmentLeft location:kNames options:@{}]];
  set.headIndent = kNames;
  set.lineBreakMode = NSLineBreakByCharWrapping;
  set.paragraphSpacing = 4;
  for (NSArray *group in groups) {
    NSArray<NSDictionary *> *headers = [group[1] isKindOfClass:NSArray.class] ? group[1] : @[];
    if (out.length) [out appendAttributedString:[[NSAttributedString alloc] initWithString:@"\n"]];
    [out appendAttributedString:[[NSAttributedString alloc] initWithString:[group[0] stringByAppendingString:@"\n"] attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightSemibold], NSForegroundColorAttributeName: MVQuietColor()}]];
    if (!headers.count) [out appendAttributedString:[[NSAttributedString alloc] initWithString:[MVWord(@"None") stringByAppendingString:@"\n"] attributes:inked(MVQuietColor(), set)]];
    for (NSDictionary *header in headers) {
      if (![header isKindOfClass:NSDictionary.class]) continue;
      [out appendAttributedString:[[NSAttributedString alloc] initWithString:[[header[@"name"] description] stringByAppendingString:@"\t"] attributes:inked(MVQuietColor(), set)]];
      [out appendAttributedString:[[NSAttributedString alloc] initWithString:[[header[@"value"] description] stringByAppendingString:@"\n"] attributes:inked([header[@"value"] isEqual:@"•••"] ? MVQuietColor() : MVInkColor(), set)]];
    }
  }
  return out;
}
