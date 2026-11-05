// Typing, through the system's own text input: a dead key, an accent held down and an input method all end in
// `insertText:`, and what does not type goes as a key. What is typed reaches the device and nothing else.
#import "Window.h"

// the most a paste carries: typed one key at a time, a long text would hold the device for minutes
static const NSUInteger kPasteLimit = 4096;

@implementation MVView (Typing)

- (void)keyDown:(NSEvent *)event {
  if (!self.takesKeys) return;
  uint16_t usage = MVUsageOfKeyCode(event.keyCode);
  if (usage && !self.hasMarkedText) {
    MVEmitFrom(self, @{@"op": @"key", @"page": @7, @"usage": @(usage), @"state": @1});
    return;
  }
  // a dead key has no characters yet: it is the system's to compose
  if (event.characters.length == 0 || MVIsTypedText(event.characters, event.modifierFlags)) [self interpretKeyEvents:@[event]];
}

- (void)keyUp:(NSEvent *)event {
  if (!self.takesKeys) return;
  uint16_t usage = MVUsageOfKeyCode(event.keyCode);
  if (usage) MVEmitFrom(self, @{@"op": @"key", @"page": @7, @"usage": @(usage), @"state": @2});
}

- (void)paste:(nullable id)sender {
  if (!self.takesPointer) return;
  NSString *text = [NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString];
  if (!text.length) return;
  if (text.length > kPasteLimit) {
    [(MVWindow *)self.window.delegate sayNote:[NSString stringWithFormat:@"Pasted the first %lu of %lu characters", (unsigned long)kPasteLimit, (unsigned long)text.length]];
    text = [text substringToIndex:[text rangeOfComposedCharacterSequenceAtIndex:kPasteLimit].location];
  }
  MVEmitFrom(self, @{@"op": @"text", @"s": text});
}

- (void)insertText:(id)string replacementRange:(NSRange)range {
  NSString *text = [string isKindOfClass:NSAttributedString.class] ? [string string] : string;
  self.composing = nil;
  if (text.length) MVEmitFrom(self, @{@"op": @"text", @"s": text});
}

- (void)setMarkedText:(id)string selectedRange:(NSRange)selected replacementRange:(NSRange)range {
  self.composing = [string isKindOfClass:NSAttributedString.class] ? [string string] : string;
}

- (void)unmarkText {
  self.composing = nil;
}

- (BOOL)hasMarkedText {
  return self.composing.length > 0;
}

- (NSRange)markedRange {
  return self.hasMarkedText ? NSMakeRange(0, self.composing.length) : NSMakeRange(NSNotFound, 0);
}

- (NSRange)selectedRange {
  return NSMakeRange(self.composing.length, 0);
}

- (NSArray<NSAttributedStringKey> *)validAttributesForMarkedText {
  return @[];
}

- (nullable NSAttributedString *)attributedSubstringForProposedRange:(NSRange)range actualRange:(nullable NSRangePointer)actual {
  return nil;
}

- (NSUInteger)characterIndexForPoint:(NSPoint)point {
  return 0;
}

/// The middle of the screen: the device's caret is not known here, and an accent's popup needs a place.
- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(nullable NSRangePointer)actual {
  NSRect middle = NSMakeRect(NSMidX(self.bounds), NSMidY(self.bounds), 1, 18);
  return [self.window convertRectToScreen:[self convertRect:middle toView:nil]];
}

- (void)doCommandBySelector:(SEL)selector {
  // what is no text here is a key, and went as one: nothing beeps
}

@end
