// What a send pane asks of the parent, and what an op answered it as it comes: a line of progress while it runs, then what
// it did, or why not and what to do. The words are the op's own, as an agent reads them, and nothing of a refusal is cut.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kMark = 13, kSlide = 8;
// the Inspector's words, less the mark beside them
static const double kWordsWide = 264;
static NSString *const kSending = @"arrow.up.forward.circle";

/// Words that wrap to as many lines as they take, and can be selected to copy.
static NSTextField *wrapped(MVStyle style) {
  NSTextField *field = MVWrappedText(@"", style);
  field.maximumNumberOfLines = 0;
  field.preferredMaxLayoutWidth = kWordsWide;
  field.selectable = YES;
  return field;
}

NSTextField *MVSendField(NSString *name, NSString *placeholder, NSString *label, id target, SEL action) {
  NSTextField *field = [NSTextField textFieldWithString:@""];
  field.identifier = name;
  field.placeholderString = MVWord(placeholder);
  field.accessibilityLabel = MVWord(label);
  field.cell.sendsActionOnEndEditing = NO;
  field.target = target;
  field.action = action;
  return field;
}

void MVPaneSend(NSView<MVSendPane> *pane, NSDictionary *message) {
  if (pane.onSend) return pane.onSend(message);
  MVEmitFrom(pane, message);
}

@implementation MVAnswerView {
  NSTextField *_words, *_what;
  MVInk *_mark;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _mark = [[MVInk alloc] initWithSymbol:kSending color:MVQuietColor() size:kMark];
    _words = wrapped(MVStyleBody);
    _what = wrapped(MVStyleSub);
    NSStackView *lines = [NSStackView stackViewWithViews:@[_words, _what]];
    lines.orientation = NSUserInterfaceLayoutOrientationVertical;
    lines.alignment = NSLayoutAttributeLeading;
    lines.spacing = 2;
    // the mark keeps its width, and the words take the rest
    [_mark.widthAnchor constraintEqualToConstant:kMark + 4].active = YES;
    [lines setHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    [self addArrangedSubview:_mark];
    [self addArrangedSubview:lines];
    self.alignment = NSLayoutAttributeTop;
    self.hidden = YES;
  }
  return self;
}

- (void)say:(NSString *)words what:(NSString *)what symbol:(NSString *)symbol color:(NSColor *)color {
  self.hidden = NO;
  [_mark paint:symbol color:color];
  _words.stringValue = words;
  _what.stringValue = what;
  _what.hidden = !what.length;
}

- (void)sending:(NSString *)words {
  _waiting = YES;
  [self say:words what:@"" symbol:kSending color:MVQuietColor()];
}

- (void)show:(NSDictionary *)m {
  if (m[@"line"] && _waiting) [self say:MVWord(m[@"line"]) what:@"" symbol:kSending color:MVQuietColor()];
  if (!m[@"ok"]) return;
  _waiting = NO;
  BOOL ok = [m[@"ok"] boolValue];
  // a state has its symbol and its words as well as its colour
  [self say:MVWord(m[@"text"] ?: @"") what:MVWord(m[@"hint"] ?: @"") symbol:ok ? @"checkmark.circle.fill" : @"exclamationmark.triangle.fill" color:ok ? MVGreen() : MVRed()];
  MVSlideIn(self, kSlide);
  MVAnnounce(_what.stringValue.length ? [NSString stringWithFormat:@"%@. %@", _words.stringValue, _what.stringValue] : _words.stringValue);
}

- (NSString *)said {
  return self.hidden ? @"" : _words.stringValue;
}

- (NSString *)hint {
  return _what.stringValue;
}

@end
