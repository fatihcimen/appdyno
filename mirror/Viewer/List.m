// Rows of a title and a line beneath, with a symbol: the Inspector's lists and a sidebar.
#import "Window.h"

static const double kHeaderHeight = 26;

@implementation MVRow
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

- (void)setRows:(NSArray<MVRow *> *)rows {
  _rows = [rows copy];
  [_table reloadData];
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
  return _rows[at].header;
}

- (BOOL)tableView:(NSTableView *)table shouldSelectRow:(NSInteger)at {
  return !_rows[at].header;
}

- (CGFloat)tableView:(NSTableView *)table heightOfRow:(NSInteger)at {
  return _rows[at].header ? kHeaderHeight : table.rowHeight;
}

- (void)useSidebarStyle {
  _table.style = NSTableViewStyleSourceList;
}

- (void)tableViewSelectionDidChange:(NSNotification *)notification {
  if (self.onSelect) self.onSelect(self.selected);
}

- (NSView *)headerCell:(NSString *)text in:(NSTableCellView *)cell {
  NSTextField *title = [NSTextField labelWithString:text];
  title.font = [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold];
  title.textColor = NSColor.secondaryLabelColor;
  title.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:title];
  [NSLayoutConstraint activateConstraints:@[
    [title.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:4],
    [title.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
  ]];
  return cell;
}

- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)at {
  MVRow *row = _rows[at];
  NSTableCellView *cell = [NSTableCellView new];
  if (row.header) return [self headerCell:row.title in:cell];
  NSImageView *icon = [NSImageView new];
  icon.image = row.symbol ? [NSImage imageWithSystemSymbolName:row.symbol accessibilityDescription:nil] : nil;
  icon.contentTintColor = row.tint ?: NSColor.secondaryLabelColor;
  NSTextField *title = [NSTextField labelWithString:row.title];
  title.font = [NSFont systemFontOfSize:12 weight:NSFontWeightMedium];
  title.lineBreakMode = NSLineBreakByTruncatingTail;
  NSTextField *detail = [NSTextField labelWithString:row.detail];
  detail.font = [NSFont systemFontOfSize:10.5];
  detail.textColor = NSColor.secondaryLabelColor;
  detail.lineBreakMode = NSLineBreakByTruncatingMiddle;
  NSStackView *lines = [NSStackView stackViewWithViews:@[title, detail]];
  lines.orientation = NSUserInterfaceLayoutOrientationVertical;
  lines.alignment = NSLayoutAttributeLeading;
  lines.spacing = 1;
  [lines setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSStackView *stack = [NSStackView stackViewWithViews:@[icon, lines]];
  stack.spacing = 8;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [icon.widthAnchor constraintEqualToConstant:18],
    [stack.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:4],
    [stack.trailingAnchor constraintLessThanOrEqualToAnchor:cell.trailingAnchor constant:-4],
    [stack.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
  ]];
  return cell;
}

@end
