// A list's own parts, for the two files it is written in: its table, its rows' cells, and what one file asks of the other.
#import "Window.h"

NS_ASSUME_NONNULL_BEGIN

/// Its title is its own: as a cell's `textField` the table would take over its colour.
@interface MVRowCell : NSTableCellView
@property(nonatomic) NSTextField *title;
/// A row of one line: the row itself, its mark and its figures, which all turn to the main ink where the row is chosen.
@property(nonatomic, nullable) MVRow *line;
@property(nonatomic, nullable) NSView *mark;
@property(nonatomic, nullable) NSArray<NSTextField *> *figures;
@property(nonatomic, copy, nullable) void (^onPress)(void);
- (void)choose:(BOOL)chosen;
@end

/// The table of a list: a key pressed while it has the keyboard is the list's to act on, and reaches nothing else.
@interface MVKeyTable : NSTableView
@property(nonatomic, copy, nullable) BOOL (^onKey)(NSString *key);
@end

@interface MVList () {
  NSArray<MVRow *> *_rows;
  MVKeyTable *_table;
  BOOL _arrives, _lines, _still;
}
@end

/// A list of one-line rows under headings that stay in sight.
@interface MVList (Lines)
- (void)setLines:(NSArray<MVRow *> *)rows;
- (void)lineClicked:(nullable id)sender;
- (NSView *)hostCell:(MVRow *)row;
- (NSView *)lineCell:(MVRow *)row;
@end

NS_ASSUME_NONNULL_END
