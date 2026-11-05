// Rows of a title and a line beneath, with a symbol: the Inspector's lists and a sidebar.
#import "Window.h"

static const double kHeaderHeight = 30, kChangeSeconds = 0.2;

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

- (void)setRows:(NSArray<MVRow *> *)rows {
  if (_table.style == NSTableViewStyleSourceList && MVMoves() && _rows.count && [self changeTo:rows]) return;
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
  return !_rows[at].header || _rows[at].key;
}

- (CGFloat)tableView:(NSTableView *)table heightOfRow:(NSInteger)at {
  return _rows[at].header ? kHeaderHeight : table.rowHeight;
}

- (void)useSidebarStyle {
  _table.style = NSTableViewStyleSourceList;
  _table.rowHeight = 44;
}

- (void)tableViewSelectionDidChange:(NSNotification *)notification {
  if (self.onSelect) self.onSelect(self.selected);
}

- (NSView *)headerCell:(NSString *)text in:(NSTableCellView *)cell {
  NSTextField *title = MVText(text, MVStyleHeading);
  title.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:title];
  [NSLayoutConstraint activateConstraints:@[
    [title.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:6],
    [title.bottomAnchor constraintEqualToAnchor:cell.bottomAnchor constant:-4],
  ]];
  return cell;
}

- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)at {
  MVRow *row = _rows[at];
  NSTableCellView *cell = [NSTableCellView new];
  cell.toolTip = row.help;
  if (row.header) return [self headerCell:row.title in:cell];
  NSView *icon = row.symbol ? [[MVInk alloc] initWithSymbol:row.symbol color:row.tint ?: NSColor.labelColor size:15] : [NSView new];
  NSTextField *title = MVText(row.title, MVStyleBody);
  NSTextField *detail = MVText(row.detail, MVStyleSub);
  detail.lineBreakMode = NSLineBreakByTruncatingMiddle;
  NSStackView *lines = [NSStackView stackViewWithViews:@[title, detail]];
  lines.orientation = NSUserInterfaceLayoutOrientationVertical;
  lines.alignment = NSLayoutAttributeLeading;
  lines.spacing = 1;
  [lines setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSStackView *stack = [NSStackView stackViewWithViews:@[icon, lines]];
  stack.spacing = 8;
  if (row.dot) {
    MVInk *dot = [[MVInk alloc] initWithSymbol:@"circle.fill" color:row.dot size:8];
    dot.translatesAutoresizingMaskIntoConstraints = NO;
    [cell addSubview:dot];
    [NSLayoutConstraint activateConstraints:@[
      [dot.trailingAnchor constraintEqualToAnchor:cell.trailingAnchor constant:-8],
      [dot.widthAnchor constraintEqualToConstant:10],
      [dot.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
    ]];
  }
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [icon.widthAnchor constraintEqualToConstant:18],
    [stack.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:6],
    [stack.trailingAnchor constraintLessThanOrEqualToAnchor:cell.trailingAnchor constant:-4],
    [stack.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
  ]];
  return cell;
}

@end
