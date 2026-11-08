// Rows of a title and a line beneath, with a symbol: the Inspector's lists and a sidebar.
#import "Place.h"
#import "Window.h"

static const double kHeaderHeight = 30, kChangeSeconds = 0.2, kTileSide = 26, kChosenAlpha = 0.2, kChosenRound = 10, kChosenInset = 4;

/// Its title is its own: as a cell's `textField` the table would take over its colour.
@interface MVRowCell : NSTableCellView
@property(nonatomic) NSTextField *title;
@end

@implementation MVRowCell
@end

@interface MVRowView : NSTableRowView
@end

@implementation MVRowView
- (void)drawSelectionInRect:(NSRect)dirty {
  NSRect pill = NSInsetRect(self.bounds, kChosenInset, 1);
  NSBezierPath *shape = [NSBezierPath bezierPathWithRoundedRect:pill xRadius:kChosenRound yRadius:kChosenRound];
  [[MVAccent() colorWithAlphaComponent:kChosenAlpha] setFill];
  [shape fill];
  if (!MVWithoutColor()) return;
  [MVInkColor() setStroke];
  [shape stroke];
}

- (void)weigh {
  for (NSView *view in self.subviews)
    if ([view isKindOfClass:MVRowCell.class]) ((MVRowCell *)view).title.font = [NSFont systemFontOfSize:NSFont.systemFontSize weight:self.selected ? NSFontWeightSemibold : NSFontWeightRegular];
}

- (void)setSelected:(BOOL)selected {
  super.selected = selected;
  [self weigh];
}

- (void)didAddSubview:(NSView *)subview {
  [super didAddSubview:subview];
  [self weigh];
}
@end

@class MVRow;
static NSString *identityOf(MVRow *row);

@implementation MVRow
- (NSString *)identity {
  return identityOf(self);
}

+ (instancetype)headerNamed:(NSString *)title {
  MVRow *row = [MVRow new];
  row.title = title;
  row.header = YES;
  return row;
}
@end

@implementation MVList {
  NSTableView *_table;
  BOOL _arrives;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _rows = @[];
    _table = [NSTableView new];
    _table.style = NSTableViewStyleInset;
    _table.rowHeight = 38;
    _table.headerView = nil;
    _table.backgroundColor = NSColor.clearColor;
    _table.intercellSpacing = NSMakeSize(0, 2);
    [_table addTableColumn:[[NSTableColumn alloc] initWithIdentifier:@"row"]];
    _table.columnAutoresizingStyle = NSTableViewUniformColumnAutoresizingStyle;
    _table.dataSource = self;
    _table.delegate = self;
    self.documentView = _table;
    self.hasVerticalScroller = YES;
    self.autohidesScrollers = YES;
    self.drawsBackground = NO;
  }
  return self;
}

static NSString *identityOf(MVRow *row) {
  return row.key ?: row.title;
}

/// What comes opens and what goes closes, where nothing else moved: a device arriving is a state changing.
- (BOOL)changeTo:(NSArray<MVRow *> *)rows {
  NSArray *before = [_rows valueForKey:@"identity"], *after = [rows valueForKey:@"identity"];
  NSIndexSet *gone = [before indexesOfObjectsPassingTest:^BOOL(id one, NSUInteger i, BOOL *stop) {
    return ![after containsObject:one];
  }];
  NSIndexSet *come = [after indexesOfObjectsPassingTest:^BOOL(id one, NSUInteger i, BOOL *stop) {
    return ![before containsObject:one];
  }];
  NSMutableArray *kept = [before mutableCopy], *still = [after mutableCopy];
  [kept removeObjectsAtIndexes:gone];
  [still removeObjectsAtIndexes:come];
  if (![kept isEqual:still] || (!gone.count && !come.count)) return NO;
  _rows = [rows copy];
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = kChangeSeconds;
    [self->_table beginUpdates];
    [self->_table removeRowsAtIndexes:gone withAnimation:NSTableViewAnimationEffectFade];
    [self->_table insertRowsAtIndexes:come withAnimation:NSTableViewAnimationEffectFade | NSTableViewAnimationSlideDown];
    [self->_table endUpdates];
  }];
  return YES;
}

- (void)setOnClick:(nullable void (^)(MVRow *))onClick {
  _onClick = [onClick copy];
  _table.target = self;
  _table.action = @selector(rowClicked:);
}

- (void)rowClicked:(id)sender {
  if (_table.clickedRow >= 0 && (NSUInteger)_table.clickedRow < _rows.count) self.onClick(_rows[_table.clickedRow]);
}

- (void)setRows:(NSArray<MVRow *> *)rows {
  if (_arrives && MVMoves() && _rows.count && [self changeTo:rows]) return;
  _rows = [rows copy];
  [_table reloadData];
}

- (void)selectKey:(nullable NSString *)key {
  if (!key) return [_table deselectAll:nil];
  [_rows enumerateObjectsUsingBlock:^(MVRow *row, NSUInteger at, BOOL *stop) {
    if (!row.header && [row.key isEqual:key]) [self->_table selectRowIndexes:[NSIndexSet indexSetWithIndex:at] byExtendingSelection:NO];
  }];
}

- (void)setRowMenu:(nullable NSMenu *)menu {
  _table.menu = menu;
}

- (nullable NSMenu *)rowMenu {
  return _table.menu;
}

- (nullable NSString *)clickedKey {
  return _table.clickedRow >= 0 && (NSUInteger)_table.clickedRow < _rows.count ? _rows[_table.clickedRow].key : nil;
}

- (NSPoint)pointOfRow:(NSUInteger)at {
  NSRect row = [_table rectOfRow:at];
  return [_table convertPoint:NSMakePoint(NSMidX(row), NSMidY(row)) toView:nil];
}

- (void)scrollToEnd {
  if (_rows.count) [_table scrollRowToVisible:_rows.count - 1];
}

- (nullable MVRow *)selected {
  return _table.selectedRow >= 0 && (NSUInteger)_table.selectedRow < _rows.count ? _rows[_table.selectedRow] : nil;
}

- (NSInteger)numberOfRowsInTableView:(NSTableView *)table {
  return _rows.count;
}

- (BOOL)tableView:(NSTableView *)table isGroupRow:(NSInteger)at {
  return NO;
}

- (BOOL)tableView:(NSTableView *)table shouldSelectRow:(NSInteger)at {
  return !self.onClick && (!_rows[at].header || _rows[at].key);
}

- (CGFloat)tableView:(NSTableView *)table heightOfRow:(NSInteger)at {
  return _rows[at].header ? kHeaderHeight : table.rowHeight;
}

- (void)useSidebarStyle {
  _table.style = NSTableViewStyleSourceList;
  _table.rowHeight = 44;
  _arrives = YES;
}

- (void)letRowsArrive {
  _arrives = YES;
}

- (NSTableRowView *)tableView:(NSTableView *)table rowViewForRow:(NSInteger)at {
  return table.style == NSTableViewStyleSourceList ? [MVRowView new] : nil;
}

- (void)tableViewSelectionDidChange:(NSNotification *)notification {
  if (self.onSelect) self.onSelect(self.selected);
}

- (NSView *)headerCell:(NSString *)text in:(NSTableCellView *)cell {
  NSTextField *title = MVText(text, MVStyleHeading);
  title.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:title];
  [NSLayoutConstraint activateConstraints:@[
    [title.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor
                                        constant:6],
    [title.bottomAnchor constraintEqualToAnchor:cell.bottomAnchor
                                       constant:-4],
  ]];
  return cell;
}

- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)at {
  MVRow *row = _rows[at];
  MVRowCell *cell = [MVRowCell new];
  cell.toolTip = row.help;
  if (row.header) return [self headerCell:row.title in:cell];
  NSView *icon = row.tile ? MVTile(row.symbol, row.tile, kTileSide) : row.symbol ? [[MVInk alloc] initWithSymbol:row.symbol color:row.tint ?: MVInkColor() size:15]
                                                                                 : [NSView new];
  NSTextField *title = MVText(row.title, MVStyleBody);
  cell.title = title;
  NSTextField *detail = MVText(row.detail, MVStyleSub);
  detail.lineBreakMode = NSLineBreakByTruncatingMiddle;
  detail.hidden = !row.detail.length;
  NSStackView *lines = [NSStackView stackViewWithViews:@[title, detail]];
  lines.orientation = NSUserInterfaceLayoutOrientationVertical;
  lines.alignment = NSLayoutAttributeLeading;
  lines.spacing = 1;
  [lines setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSStackView *stack = [NSStackView stackViewWithViews:@[icon, lines]];
  stack.spacing = row.tile ? 10 : 8;
  if (row.dot) {
    // a dot says what it says by its colour: a person who asked for more than colour gets a mark to read
    MVInk *dot = [[MVInk alloc] initWithSymbol:MVWithoutColor() ? row.dotShape ?: @"circle.fill" : @"circle.fill" color:row.dot size:MVWithoutColor() ? 12 : 8];
    dot.translatesAutoresizingMaskIntoConstraints = NO;
    [cell addSubview:dot];
    [NSLayoutConstraint activateConstraints:@[
      [dot.trailingAnchor constraintEqualToAnchor:cell.trailingAnchor
                                         constant:-8],
      [dot.widthAnchor constraintEqualToConstant:14],
      [dot.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
    ]];
  }
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [icon.widthAnchor constraintEqualToConstant:row.tile ? kTileSide : 18],
    [stack.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor
                                        constant:row.tile ? 8 : 6],
    [stack.trailingAnchor constraintLessThanOrEqualToAnchor:cell.trailingAnchor
                                                   constant:-4],
    [stack.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
  ]];
  return cell;
}

@end
