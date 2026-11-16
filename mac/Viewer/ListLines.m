// A list of lines: rows of one line each, set in columns, under headings that stay in sight as the list scrolls. A
// mark, a status, a method, the row's words and what stands at its end; a heading with how many rows it has and how
// many failed. Rows read again are drawn again only where they changed, and the row chosen keeps its place.
#import "List.h"
#import "Place.h"
#import "Words.h"

static const double kLineMark = 17, kLineCode = 28, kLineMethod = 54, kLineWords = 98, kLineEnd = 12;

@implementation MVRowCell

/// On the mark of a chosen row a colour falls under 3:1, and so does the quiet ink: all of it is the main ink there, and
/// the colour comes back as the row is left.
- (void)choose:(BOOL)chosen {
  if (!_line || _line.header) return;
  if ([_mark isKindOfClass:MVInk.class]) [(MVInk *)_mark paint:_line.symbol color:chosen ? MVInkColor() : _line.tint ?
                                                                                                                     : MVQuietColor()];
  [_figures enumerateObjectsUsingBlock:^(NSTextField *figure, NSUInteger at, __unused BOOL *stop) {
    figure.textColor = chosen || (at == 0 && self->_line.strong) ? MVInkColor() : MVQuietColor();
  }];
}

- (BOOL)accessibilityPerformPress {
  if (!_onPress) return NO;
  _onPress();
  return YES;
}

@end

@implementation MVKeyTable

- (void)keyDown:(NSEvent *)event {
  NSString *typed = event.charactersIgnoringModifiers;
  unichar c = typed.length ? [typed characterAtIndex:0] : 0;
  NSString *key = c == '\r' || c == ' ' || c == NSEnterCharacter ? @"open" : c == 0x1B                                        ? @"escape"
                                                                         : c == NSDeleteCharacter || c == NSDeleteFunctionKey ? @"delete"
                                                                                                                              : nil;
  if (key && _onKey && _onKey(key)) return;
  [super keyDown:event];
}

- (void)cancelOperation:(id)sender {
  if (_onKey) _onKey(@"escape");
}

@end

/// The red of a mark: the palette's own, lifted in the dark look, where that one falls under 3:1 on a card.
NSColor *MVMarkRed(void) {
  static NSColor *red;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    red = [NSColor colorWithName:nil
                 dynamicProvider:^NSColor *(NSAppearance *look) {
                   return MVIsDark(look) ? [NSColor colorWithSRGBRed:1 green:0x9C / 255.0 blue:0x92 / 255.0 alpha:1] : MVSolid(MVRed());
                 }];
  });
  return red;
}

/// Something under way: a part of a ring that turns about its middle, in the quiet ink of the look it stands in.
@interface MVWheel : NSView
@end

@implementation MVWheel {
  CAShapeLayer *_ring;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    _ring = [CAShapeLayer layer];
    _ring.fillColor = nil;
    _ring.lineWidth = 1.6;
    _ring.lineCap = kCALineCapRound;
    [self.layer addSublayer:_ring];
  }
  return self;
}

- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  _ring.strokeColor = MVQuietColor().CGColor;
}

- (void)layout {
  [super layout];
  _ring.frame = self.bounds;
  CGMutablePathRef arc = CGPathCreateMutable();
  CGPathAddArc(arc, NULL, NSMidX(self.bounds), NSMidY(self.bounds), MIN(NSWidth(self.bounds), NSHeight(self.bounds)) / 2 - 2, 0, 1.5 * M_PI, false);
  _ring.path = arc;
  CGPathRelease(arc);
  if ([_ring animationForKey:@"turn"] || !self.window) return;
  CABasicAnimation *turn = [CABasicAnimation animationWithKeyPath:@"transform.rotation.z"];
  turn.fromValue = @0;
  turn.toValue = @(-2 * M_PI);
  turn.duration = 0.9;
  turn.repeatCount = HUGE_VALF;
  [_ring addAnimation:turn forKey:@"turn"];
}

@end

/// All a row of one line shows: two that are alike here are drawn alike.
static NSString *shown(MVRow *row) {
  return [@[row.title ?: @"", row.code ?: @"", row.ends ?: @"", row.symbol ?: @"", row.detail ?: @"", @(row.count), @(row.failed), @(row.closed), @(row.spins)] componentsJoinedByString:@"\x1f"];
}

/// A figure of a row: in digits of one width, so that a column of them reads down.
static NSTextField *figure(NSString *_Nullable text, NSFontWeight weight, NSColor *color) {
  NSTextField *field = MVContentText(text ?: @"", MVStyleSub);
  field.font = [NSFont monospacedDigitSystemFontOfSize:11 weight:weight];
  field.textColor = color;
  return field;
}

/// Views of a cell on its middle line, each from where its column starts.
static void setOut(NSTableCellView *cell, NSArray<NSView *> *views, NSArray<NSNumber *> *from) {
  [views enumerateObjectsUsingBlock:^(NSView *view, NSUInteger at, __unused BOOL *stop) {
    view.translatesAutoresizingMaskIntoConstraints = NO;
    [cell addSubview:view];
    [view.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor].active = YES;
    if (from[at].doubleValue >= 0) [view.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:from[at].doubleValue].active = YES;
  }];
}

/// A mark in a square of its own, its middle where every row's mark has it.
static void setMark(NSTableCellView *cell, NSView *mark, CGFloat side) {
  mark.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:mark];
  [NSLayoutConstraint activateConstraints:@[
    [mark.centerXAnchor constraintEqualToAnchor:cell.leadingAnchor
                                       constant:kLineMark],
    [mark.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
    [mark.widthAnchor constraintEqualToConstant:side],
    [mark.heightAnchor constraintEqualToConstant:side],
  ]];
}

@implementation MVList (Lines)

/// A click on a heading opens or closes it; one on a row chooses it, as the table has done by now.
- (void)lineClicked:(id)sender {
  NSInteger at = _table.clickedRow;
  if (at >= 0 && (NSUInteger)at < _rows.count && _rows[at].header && self.onToggle) self.onToggle(_rows[at]);
}

/// The same rows again, as a list read every few seconds gives them: only those that changed are drawn again, so that
/// the row under a pointer, an open menu and a screen reader's place all stay. Other rows: the list whole, with the row
/// chosen still chosen and no word of its having been left, and a list that stood at its end still at its end.
- (void)setLines:(NSArray<MVRow *> *)rows {
  NSArray<MVRow *> *old = _rows;
  NSString *chosen = self.selected.key;
  // asked before the rows change: the table lays itself out to answer, by the rows it still has
  NSRect seen = _table.visibleRect;
  BOOL atEnd = old.count > 0 && NSMaxY(seen) >= NSMaxY(_table.bounds) - 2 && NSHeight(_table.bounds) > NSHeight(seen);
  _rows = [rows copy];
  if ([[old valueForKey:@"identity"] isEqual:[rows valueForKey:@"identity"]]) {
    NSIndexSet *changed = [rows indexesOfObjectsPassingTest:^BOOL(MVRow *row, NSUInteger at, __unused BOOL *stop) {
      return ![shown(row) isEqual:shown(old[at])];
    }];
    if (changed.count) [_table reloadDataForRowIndexes:changed columnIndexes:[NSIndexSet indexSetWithIndex:0]];
    return;
  }
  _still = YES;
  [_table reloadData];
  [self selectKey:chosen];
  _still = NO;
  if (chosen && !self.selected && self.onSelect) self.onSelect(nil);
  if (atEnd && rows.count > old.count) [self scrollToEnd];
}

/// What a screen reader has of a row: its words whole, and what there is to do with it.
- (void)name:(MVRowCell *)cell as:(MVRow *)row {
  cell.accessibilityElement = YES;
  cell.accessibilityRole = NSAccessibilityStaticTextRole;
  cell.accessibilityLabel = row.says ?: row.title;
  cell.accessibilityChildren = @[];
  if (self.rowActions && !row.header) cell.accessibilityCustomActions = self.rowActions(row);
}

/// A heading of a list of lines: open or closed, its name, how many of its rows failed and how many it has.
- (NSView *)hostCell:(MVRow *)row {
  MVRowCell *cell = [MVRowCell new];
  cell.line = row;
  setMark(cell, [[MVInk alloc] initWithSymbol:row.closed ? @"chevron.right" : @"chevron.down" color:MVQuietColor() size:9], 14);
  NSMutableAttributedString *name = [[NSMutableAttributedString alloc] initWithString:row.line ?: row.title attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:12 weight:NSFontWeightSemibold], NSForegroundColorAttributeName: MVInkColor()}];
  if (row.ends.length) [name appendAttributedString:[[NSAttributedString alloc] initWithString:row.ends attributes:@{NSFontAttributeName: [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightRegular], NSForegroundColorAttributeName: MVQuietColor()}]];
  NSTextField *host = MVContentText(@"", MVStyleHeading);
  host.attributedStringValue = name;
  host.lineBreakMode = NSLineBreakByTruncatingMiddle;
  [host setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSTextField *count = figure(MVCount(row.count), NSFontWeightRegular, MVQuietColor());
  NSTextField *failed = figure(MVCount(row.failed), NSFontWeightSemibold, MVInkColor());
  MVInk *mark = [[MVInk alloc] initWithSymbol:@"exclamationmark.triangle.fill" color:MVMarkRed() size:10];
  failed.hidden = mark.hidden = row.failed == 0;
  setOut(cell, @[host, mark, failed, count], @[@(kLineCode), @-1, @-1, @-1]);
  for (NSView *end in @[mark, failed, count]) [end setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  [NSLayoutConstraint activateConstraints:@[
    [count.trailingAnchor constraintEqualToAnchor:cell.trailingAnchor
                                         constant:-kLineEnd],
    [failed.trailingAnchor constraintEqualToAnchor:count.leadingAnchor
                                          constant:-10],
    [mark.trailingAnchor constraintEqualToAnchor:failed.leadingAnchor
                                        constant:-3],
    [mark.widthAnchor constraintEqualToConstant:12],
    [mark.heightAnchor constraintEqualToConstant:12],
    [host.trailingAnchor constraintLessThanOrEqualToAnchor:mark.leadingAnchor
                                                  constant:-8],
  ]];
  [self name:cell as:row];
  cell.accessibilityRole = NSAccessibilityButtonRole;
  cell.accessibilityValue = MVWord(row.closed ? @"closed" : @"open");
  __weak MVList *weak = self;
  cell.onPress = ^{
    if (weak.onToggle) weak.onToggle(row);
  };
  return cell;
}

/// A row of one line: its mark, its status, its method, its words, and what stands at its end.
- (NSView *)lineCell:(MVRow *)row {
  MVRowCell *cell = [MVRowCell new];
  cell.line = row;
  cell.toolTip = row.help;
  if (row.spins && MVMoves()) {
    cell.mark = [MVWheel new];
  } else if (row.symbol) cell.mark = [[MVInk alloc] initWithSymbol:row.symbol color:row.tint ?: MVQuietColor() size:row.tint ? 13 : 12];
  if (cell.mark) setMark(cell, cell.mark, 14);
  NSTextField *code = figure(row.code, row.strong ? NSFontWeightSemibold : NSFontWeightRegular, row.strong ? MVInkColor() : MVQuietColor());
  NSTextField *method = MVContentText(@"", MVStyleSub);
  method.attributedStringValue = [[NSAttributedString alloc] initWithString:row.method.uppercaseString ?: @"" attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightSemibold], NSKernAttributeName: @0.2, NSForegroundColorAttributeName: MVQuietColor()}];
  method.allowsDefaultTighteningForTruncation = YES;
  method.maximumNumberOfLines = 1;
  method.lineBreakMode = NSLineBreakByClipping;
  NSTextField *words = MVContentText(row.line ?: row.title ?
                                                           : @"",
                                     MVStyleBody);
  words.lineBreakMode = NSLineBreakByTruncatingMiddle;
  [words setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSTextField *ends = figure(row.ends, NSFontWeightRegular, MVQuietColor());
  [ends setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  [ends setContentCompressionResistancePriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  cell.title = words;
  cell.figures = @[code, method, ends];
  setOut(cell, @[code, method, words, ends], @[@(kLineCode), @(kLineMethod), @(row.method ? kLineWords : kLineCode), @-1]);
  [NSLayoutConstraint activateConstraints:@[
    [method.widthAnchor constraintEqualToConstant:kLineWords - kLineMethod - 2],
    [ends.trailingAnchor constraintEqualToAnchor:cell.trailingAnchor
                                        constant:-kLineEnd],
    [words.trailingAnchor constraintLessThanOrEqualToAnchor:ends.leadingAnchor
                                                   constant:-8],
  ]];
  [self name:cell as:row];
  return cell;
}

@end
