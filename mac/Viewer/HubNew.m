// The sheet that makes a new simulator or emulator, from what the parent says can be made.
#import "Window.h"
#import "Words.h"

@implementation MVNewDevice {
  NSPanel *_sheet;
  NSTextField *_name;
  NSPopUpButton *_model, *_os;
  NSArray<NSDictionary *> *_models, *_systems;
  NSString *_kind;
  __weak NSWindow *_owner;
}

static NSPopUpButton *popUp(NSArray<NSDictionary *> *rows) {
  NSPopUpButton *button = [NSPopUpButton new];
  for (NSDictionary *row in rows) [button addItemWithTitle:row[@"name"]];
  return button;
}

- (void)askIn:(NSWindow *)window kind:(NSString *)kind choices:(NSDictionary *)choices {
  _kind = kind;
  _owner = window;
  _models = choices[@"models"] ?: @[];
  _systems = choices[@"systems"] ?: @[];
  _name = [NSTextField textFieldWithString:@""];
  _name.placeholderString = [kind isEqual:@"simulator"] ? MVWord(@"The model's name") : @"appdyno_emulator";
  _model = popUp(_models);
  _os = popUp(_systems);
  // the newest comes last, and is the one a newest model runs on
  [_os selectItemAtIndex:_systems.count - 1];
  NSTextField *(^caption)(NSString *) = ^(NSString *text) {
    return [NSTextField labelWithString:text];
  };
  NSGridView *grid = [NSGridView gridViewWithViews:@[@[caption(MVWord(@"Name")), _name], @[caption(MVWord(@"Model")), _model], @[caption([kind isEqual:@"simulator"] ? @"iOS" : @"Android"), _os]]];
  grid.rowSpacing = 10;
  [grid columnAtIndex:0].xPlacement = NSGridCellPlacementTrailing;
  NSButton *cancel = [NSButton buttonWithTitle:MVWord(@"Cancel") target:self action:@selector(cancel:)];
  cancel.keyEquivalent = @"\e";
  NSButton *create = [NSButton buttonWithTitle:MVWord(@"Create") target:self action:@selector(create:)];
  create.keyEquivalent = @"\r";
  NSStackView *buttons = [NSStackView stackViewWithViews:@[cancel, create]];
  NSTextField *title = MVText([kind isEqual:@"simulator"] ? @"New Simulator" : @"New Emulator", MVStyleTitle);
  title.font = [NSFont systemFontOfSize:15 weight:NSFontWeightSemibold];
  NSStackView *stack = [NSStackView stackViewWithViews:@[title, grid, buttons]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 16;
  stack.edgeInsets = NSEdgeInsetsMake(20, 20, 20, 20);
  [buttons.trailingAnchor constraintEqualToAnchor:grid.trailingAnchor].active = YES;
  [_name.widthAnchor constraintEqualToConstant:260].active = YES;
  _sheet = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 380, 220) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  _sheet.contentView = stack;
  [window beginSheet:_sheet completionHandler:nil];
}

- (void)setName:(NSString *)name {
  _name.stringValue = name;
}

- (void)cancel:(id)sender {
  [_owner endSheet:_sheet];
}

- (void)create:(id)sender {
  if (_model.indexOfSelectedItem < 0 || _os.indexOfSelectedItem < 0) return;
  MVEmit(@{@"op": @"hub", @"action": @"new", @"kind": _kind, @"name": _name.stringValue, @"model": _models[_model.indexOfSelectedItem][@"id"], @"system": _systems[_os.indexOfSelectedItem][@"id"]});
  [_owner endSheet:_sheet];
}

@end
