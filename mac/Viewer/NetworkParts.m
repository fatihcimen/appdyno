// Small parts of the Network pane, each a control of the house: a button that is a symbol, a choice of one section among
// a few, and the field that narrows a list with its scope beside it. Each is found by a name a real click finds, says
// what it is to a screen reader, and keeps its own ink in a window behind others.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBand = 28, kSmallBand = 24, kSymbolSide = 24, kTrack = 0.09, kChipRound = 11, kChipHigh = 22;

@implementation MVSymbolButton {
  NSString *_symbol;
  NSColor *_color;
  CGFloat _size;
}

+ (instancetype)buttonNamed:(NSString *)name symbol:(NSString *)symbol size:(CGFloat)size label:(NSString *)label target:(id)target action:(SEL)action {
  MVSymbolButton *button = [MVSymbolButton buttonWithImage:[NSImage new] target:target action:action];
  button.identifier = name;
  button.bordered = NO;
  button.imagePosition = NSImageOnly;
  button.toolTip = MVWord(label);
  button.accessibilityLabel = button.toolTip;
  button->_size = size;
  [button paint:symbol color:MVInkColor()];
  [button setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  return button;
}

- (void)paint:(NSString *)symbol color:(NSColor *)color {
  _symbol = [symbol copy];
  _color = color;
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    self.image = MVSymbol(symbol, color, self->_size, NSFontWeightMedium);
  }];
}

/// Its ink is the look's own, and a look that changes draws it again.
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  if (_symbol) [self paint:_symbol color:_color];
}

- (void)setEnabled:(BOOL)enabled {
  super.enabled = enabled;
  self.alphaValue = enabled ? 1 : 0.4;
}

- (NSSize)intrinsicContentSize {
  return NSMakeSize(kSymbolSide, kSymbolSide);
}

@end

/// One section of a choice: its name, and how many it holds where that is known.
@interface MVSegmentButton : MVBarButton
@property(nonatomic) BOOL chosen, small;
@property(nonatomic, copy, nullable) NSString *count;
@end

@implementation MVSegmentButton

- (void)setChosen:(BOOL)chosen {
  _chosen = chosen;
  self.needsDisplay = YES;
}

- (void)setCount:(NSString *)count {
  _count = [count copy];
  self.needsDisplay = YES;
}

- (NSAttributedString *)words {
  CGFloat size = _small ? 12 : 13;
  NSMutableAttributedString *words = [[NSMutableAttributedString alloc] initWithString:self.title attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:size weight:_chosen ? NSFontWeightSemibold : NSFontWeightMedium], NSForegroundColorAttributeName: _chosen ? MVInkColor() : MVQuietColor()}];
  if (_count.length) [words appendAttributedString:[[NSAttributedString alloc] initWithString:[@"  " stringByAppendingString:_count] attributes:@{NSFontAttributeName: [NSFont monospacedDigitSystemFontOfSize:11 weight:NSFontWeightRegular], NSForegroundColorAttributeName: MVQuietColor()}]];
  return words;
}

- (void)drawRect:(NSRect)dirty {
  if (_chosen) {
    NSRect pill = NSInsetRect(self.bounds, 2, 2);
    [[NSColor colorWithWhite:1 alpha:MVIsDark(self.effectiveAppearance) ? 0.16 : 0.8] setFill];
    [[NSBezierPath bezierPathWithRoundedRect:pill xRadius:NSHeight(pill) / 2 yRadius:NSHeight(pill) / 2] fill];
  }
  NSAttributedString *words = self.words;
  NSSize size = words.size;
  [words drawAtPoint:NSMakePoint(round(NSMidX(self.bounds) - size.width / 2), round(NSMidY(self.bounds) - size.height / 2))];
}

- (NSSize)intrinsicContentSize {
  return NSMakeSize(ceil(self.words.size.width) + 16, _small ? kSmallBand : kBand);
}

- (NSAccessibilityRole)accessibilityRole {
  return NSAccessibilityRadioButtonRole;
}

- (id)accessibilityValue {
  return @(_chosen);
}

- (NSString *)accessibilityLabel {
  return _count.length ? [NSString stringWithFormat:@"%@, %@", self.title, _count] : self.title;
}

@end

@implementation MVSegments {
  NSArray<MVSegmentButton *> *_buttons;
}

- (instancetype)initWithNames:(NSArray<NSString *> *)names titles:(NSArray<NSString *> *)titles small:(BOOL)small {
  if ((self = [super initWithFrame:NSZeroRect])) {
    NSMutableArray<MVSegmentButton *> *buttons = [NSMutableArray array];
    [names enumerateObjectsUsingBlock:^(NSString *name, NSUInteger at, __unused BOOL *stop) {
      MVSegmentButton *button = [MVSegmentButton buttonWithTitle:MVWord(titles[at]) target:self action:@selector(pressed:)];
      button.identifier = name;
      button.bordered = NO;
      button.tag = (NSInteger)at;
      button.small = small;
      button.chosen = at == 0;
      [buttons addObject:button];
    }];
    _buttons = buttons;
    NSStackView *row = [NSStackView stackViewWithViews:buttons];
    row.distribution = NSStackViewDistributionFillEqually;
    row.spacing = 0;
    // as wide as the pane gives it, each section an equal share
    [row setHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    for (NSView *button in buttons) [button setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    row.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:row];
    self.wantsLayer = YES;
    self.layer.cornerRadius = (small ? kSmallBand : kBand) / 2;
    [NSLayoutConstraint activateConstraints:@[
      [self.heightAnchor constraintEqualToConstant:small ? kSmallBand : kBand],
      [row.topAnchor constraintEqualToAnchor:self.topAnchor],
      [row.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
      [row.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [row.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
    ]];
    self.accessibilityRole = NSAccessibilityRadioGroupRole;
  }
  return self;
}

- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  self.layer.backgroundColor = MVRule(kTrack).CGColor;
}

- (BOOL)isAccessibilityElement {
  return YES;
}

- (void)setChosen:(NSInteger)chosen {
  _chosen = chosen;
  for (MVSegmentButton *button in _buttons) button.chosen = button.tag == chosen;
}

- (void)setCount:(nullable NSString *)count at:(NSInteger)at {
  if (at >= 0 && at < (NSInteger)_buttons.count) _buttons[(NSUInteger)at].count = count;
}

- (void)pressed:(NSButton *)sender {
  if (sender.tag == _chosen) return;
  self.chosen = sender.tag;
  if (self.onChoose) self.onChoose(sender.tag);
}

@end

/// The scope beside a filter: a mark, a word and how many, lit while it narrows the list.
@interface MVScopeChip : MVBarButton
@property(nonatomic) BOOL on;
@property(nonatomic) NSUInteger count;
@end

@implementation MVScopeChip

- (void)setOn:(BOOL)on {
  _on = on;
  self.needsDisplay = YES;
}

- (void)setCount:(NSUInteger)count {
  _count = count;
  [self invalidateIntrinsicContentSize];
  self.needsDisplay = YES;
}

- (NSAttributedString *)words {
  NSMutableAttributedString *words = [[NSMutableAttributedString alloc] initWithString:self.title attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:12 weight:NSFontWeightMedium], NSForegroundColorAttributeName: MVInkColor()}];
  [words appendAttributedString:[[NSAttributedString alloc] initWithString:[@"  " stringByAppendingString:MVCount(_count)] attributes:@{NSFontAttributeName: [NSFont monospacedDigitSystemFontOfSize:11 weight:NSFontWeightRegular], NSForegroundColorAttributeName: MVQuietColor()}]];
  return words;
}

- (void)drawRect:(NSRect)dirty {
  NSRect box = NSInsetRect(self.bounds, 0.5, (NSHeight(self.bounds) - kChipHigh) / 2 + 0.5);
  NSBezierPath *shape = [NSBezierPath bezierPathWithRoundedRect:box xRadius:kChipRound yRadius:kChipRound];
  [(_on ? [MVAccent() colorWithAlphaComponent:0.2] : MVRule(kTrack)) setFill];
  [shape fill];
  if (_on || MVStrongContrast()) {
    [(_on ? MVAccent() : MVRule(0.4)) setStroke];
    [shape stroke];
  }
  NSImage *mark = MVSymbol(@"exclamationmark.triangle.fill", MVRed(), 10, NSFontWeightSemibold);
  NSAttributedString *words = self.words;
  NSSize size = words.size;
  CGFloat left = NSMinX(box) + 8;
  [mark drawInRect:NSMakeRect(left, round(NSMidY(box) - mark.size.height / 2), mark.size.width, mark.size.height)];
  [words drawAtPoint:NSMakePoint(left + mark.size.width + 4, round(NSMidY(box) - size.height / 2))];
}

- (NSSize)intrinsicContentSize {
  return NSMakeSize(ceil(self.words.size.width) + 8 + 14 + 4 + 8, kChipHigh);
}

- (NSAccessibilityRole)accessibilityRole {
  return NSAccessibilityCheckBoxRole;
}

- (id)accessibilityValue {
  return @(_on);
}

- (NSString *)accessibilityLabel {
  return [NSString stringWithFormat:@"%@, %@", self.title, MVCount(_count)];
}

@end

@interface MVFilterField () <NSTextFieldDelegate>
@end

@implementation MVFilterField {
  NSTextField *_field;
  MVScopeChip *_chip;
  MVSymbolButton *_clear;
  NSView *_plate;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _field = MVSendField(@"networkFilter", @"Filter", @"Filter by address, method or status", self, @selector(changed:));
    _field.delegate = self;
    _field.usesSingleLineMode = YES;
    _field.lineBreakMode = NSLineBreakByTruncatingTail;
    _field.toolTip = MVWord(@"Filter by address, method or status");
    _chip = [MVScopeChip buttonWithTitle:MVWord(@"Failed") target:self action:@selector(scoped:)];
    _chip.identifier = @"networkFailed";
    _chip.bordered = NO;
    _chip.toolTip = MVWord(@"Shows only the requests that failed");
    _chip.hidden = YES;
    [_chip setContentCompressionResistancePriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
    _clear = [MVSymbolButton buttonNamed:@"networkFilterClear" symbol:@"xmark.circle.fill" size:12 label:@"Clear the filter" target:self action:@selector(clear:)];
    [_clear paint:@"xmark.circle.fill" color:MVQuietColor()];
    _clear.hidden = YES;
    NSStackView *end = [NSStackView stackViewWithViews:@[_clear, _chip]];
    end.spacing = 4;
    _plate = MVFieldPlate(_field, end);
    // the mark of a filter stands before its words: the plate's own inset, and then the mark's width
    MVInk *mark = [[MVInk alloc] initWithSymbol:@"magnifyingglass" color:MVQuietColor() size:12];
    mark.translatesAutoresizingMaskIntoConstraints = NO;
    [_plate addSubview:mark];
    for (NSLayoutConstraint *one in _plate.constraints)
      if (one.firstItem == _field && one.firstAttribute == NSLayoutAttributeLeading) one.constant = 10 + 14 + 6;
    _plate.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:_plate];
    [NSLayoutConstraint activateConstraints:@[
      [mark.leadingAnchor constraintEqualToAnchor:_plate.leadingAnchor
                                         constant:10],
      [mark.centerYAnchor constraintEqualToAnchor:_plate.centerYAnchor],
      [mark.widthAnchor constraintEqualToConstant:14],
      [mark.heightAnchor constraintEqualToConstant:14],
      [_plate.topAnchor constraintEqualToAnchor:self.topAnchor],
      [_plate.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
      [_plate.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [_plate.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
    ]];
  }
  return self;
}

- (NSString *)words {
  return [_field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
}

- (void)setWords:(NSString *)words {
  _field.stringValue = words;
  [self changed:nil];
}

- (BOOL)failedOnly {
  return _chip.on;
}

- (void)setFailedOnly:(BOOL)failedOnly {
  _chip.on = failedOnly;
  [self changed:nil];
}

/// How many failed, of all that are listed: with none, and the scope off, it stays out of the way.
- (void)setFailed:(NSUInteger)failed {
  _failed = failed;
  _chip.count = failed;
  _chip.hidden = failed == 0 && !_chip.on;
}

- (void)focus {
  [self.window makeFirstResponder:_field];
}

- (void)controlTextDidChange:(NSNotification *)note {
  [self changed:nil];
}

/// Esc empties it, as a search field's does.
- (BOOL)control:(NSControl *)control textView:(NSTextView *)text doCommandBySelector:(SEL)command {
  if (command != @selector(cancelOperation:) || !_field.stringValue.length) return NO;
  [self clear:nil];
  return YES;
}

- (void)clear:(id)sender {
  _field.stringValue = @"";
  [self changed:nil];
}

- (void)scoped:(id)sender {
  self.failedOnly = !_chip.on;
}

- (void)changed:(id)sender {
  _clear.hidden = !_field.stringValue.length;
  if (self.onChange) self.onChange();
}

@end
