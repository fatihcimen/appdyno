// Tools: what appdyno does at a terminal, from the window. Each row is a command of the parent's own table, run by the parent
// as a person would run it. A section has its colour, and an index that stays in sight while the page scrolls.
#import "HubParts.h"
#import "Window.h"
#import "Words.h"

static const double kFieldWide = 300, kTile = 22, kIndexTile = 18, kIndexHigh = 44;

/// A row: the command's name, its title, what it does, what it cannot run without, and the word on its button.
static NSArray<NSDictionary *> *sections(BOOL fromApp) {
  NSMutableArray *mac = [@[
    @[@"tools", @"Get Trace Tools", @"Download what frame timelines need.", @"", @"Get"],
    @[@"clients-preview", @"Add to All AI Clients", @"Show the lines first, then add this server to each client.", @"", @"Show Lines"],
    @[@"update-check", @"Check for Updates", @"Look for a newer release, and change nothing.", @"", @"Check"],
    @[@"update", @"Update", @"Move to the latest release, verified before anything changes.", @"", @"Update"],
  ] mutableCopy];
  if (fromApp) {
    [mac insertObject:@[@"path-on", @"Add to PATH", @"Put this appdyno on the PATH of every shell.", @"", @"Add"] atIndex:2];
    [mac insertObject:@[@"path-off", @"Take off PATH", @"Take this appdyno off the PATH again.", @"", @"Remove"] atIndex:3];
  }
  return @[
    @{@"title": @"Performance Gate", @"symbol": @"gauge.with.dots.needle.33percent", @"hue": @0, @"rows": @[
      @[@"baseline", @"Save as Baseline", @"Keep the newest runs as what later ones are compared with.", @"a", @"Save"],
      @[@"compare", @"Compare with Baseline", @"Say whether the newest runs got worse.", @"a", @"Compare"],
      @[@"why", @"Find Out Why", @"Find a regression's cause on the device.", @"a", @"Find Out"],
      @[@"survey", @"Measure Everything", @"Run every measure on the device in turn, then write the page.", @"ad", @"Start"],
    ]},
    @{@"title": @"Flows", @"symbol": @"arrow.triangle.branch", @"hue": @1, @"rows": @[@[@"flows", @"Run Flows", @"Replay every flow in the folder on the device.", @"df", @"Run"]]},
    @{@"title": @"Record", @"symbol": @"record.circle", @"hue": @2, @"rows": @[
      @[@"timeline", @"Timeline", @"Keep video, touches, frames and requests on one clock for 30 s.", @"ad", @"Record"],
      @[@"flight", @"Flight Recorder", @"Keep the last seconds of the app, saved on a crash or a stall, until you stop it.", @"ad", @"Start"],
    ]},
    @{@"title": @"Reports", @"symbol": @"chart.bar.doc.horizontal", @"hue": @3, @"rows": @[@[@"dashboard", @"Dashboard", @"Write one page of what was measured, and open it.", @"", @"Open"]]},
    @{@"title": @"This Mac", @"symbol": @"desktopcomputer", @"hue": @4, @"rows": mac},
  ];
}

@interface MVToolsPane () <NSComboBoxDelegate, NSTextFieldDelegate>
@end

@implementation MVToolsPane {
  NSMutableDictionary<NSString *, MVToolRow *> *_rows;
  NSMutableArray<NSView *> *_sectionViews;
  NSComboBox *_app;
  NSTextField *_folder, *_device;
  NSStackView *_column, *_index;
  NSDictionary *_shownDevice;
  BOOL _fromApp;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _column = MVPlaceColumn(@[], 18);
    _index = [NSStackView stackViewWithViews:@[]];
    _index.spacing = 6;
    NSScrollView *page = MVPlacePage(_column);
    for (NSView *part in @[_index, page]) {
      part.translatesAutoresizingMaskIntoConstraints = NO;
      [self addSubview:part];
    }
    [NSLayoutConstraint activateConstraints:@[
      [_index.topAnchor constraintEqualToAnchor:self.safeAreaLayoutGuide.topAnchor],
      [_index.centerXAnchor constraintEqualToAnchor:self.centerXAnchor],
      [_index.heightAnchor constraintEqualToConstant:kIndexHigh],
      [page.topAnchor constraintEqualToAnchor:_index.bottomAnchor],
      [page.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [page.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
      [page.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
    ]];
    [self build];
  }
  return self;
}

- (void)build {
  for (NSView *view in _column.arrangedSubviews) [view removeFromSuperview];
  for (NSView *view in _index.arrangedSubviews) [view removeFromSuperview];
  _rows = [NSMutableDictionary dictionary];
  _sectionViews = [NSMutableArray array];
  [_column addArrangedSubview:MVPlaceHead(@"wrench.and.screwdriver", MVHueTile(2), @"Tools", @"What a terminal would do, from here: measure, compare, record and report.")];
  [_column addArrangedSubview:[self subjectCard]];
  [sections(_fromApp) enumerateObjectsUsingBlock:^(NSDictionary *section, NSUInteger at, BOOL *stop) {
    NSStackView *rows = MVPlaceColumn(@[], 0);
    for (NSArray<NSString *> *row in section[@"rows"]) {
      if (rows.arrangedSubviews.count) [rows addArrangedSubview:MVSeparator()];
      [rows addArrangedSubview:[self rowFor:row hue:[section[@"hue"] integerValue]]];
    }
    NSView *whole = MVPlaceColumn(@[MVText(section[@"title"], MVStyleStrong), MVCard(rows, 2)], 6);
    [_sectionViews addObject:whole];
    [_column addArrangedSubview:whole];
    [_index addArrangedSubview:[self indexButton:section at:at]];
  }];
  [self refreshRows];
}

- (NSView *)indexButton:(NSDictionary *)section at:(NSUInteger)at {
  NSButton *button = [MVBarButton buttonWithTitle:MVWord(section[@"title"]) target:self action:@selector(indexClicked:)];
  button.identifier = [NSString stringWithFormat:@"index:%lu", (unsigned long)at];
  button.bordered = NO;
  button.font = [NSFont systemFontOfSize:12 weight:NSFontWeightMedium];
  button.contentTintColor = MVInkColor();
  NSStackView *chip = [NSStackView stackViewWithViews:@[MVTile(section[@"symbol"], MVHueTile([section[@"hue"] integerValue]), kIndexTile), button]];
  chip.spacing = 4;
  return chip;
}

- (void)indexClicked:(NSButton *)sender {
  NSView *section = _sectionViews[[sender.identifier substringFromIndex:@"index:".length].integerValue];
  [section scrollRectToVisible:section.bounds];
}

/// What the rows run on: one app, one device and one folder, chosen once for all of them.
- (NSView *)subjectCard {
  NSString *kept = _app.stringValue;
  _app = [NSComboBox new];
  _app.identifier = @"app";
  _app.stringValue = kept ?: MVFrontApp() ?: @"";
  _app.placeholderString = MVWord(@"Choose an app, or type its id");
  _app.delegate = self;
  [_app.widthAnchor constraintEqualToConstant:kFieldWide].active = YES;
  NSString *where = _folder.stringValue;
  _folder = [NSTextField textFieldWithString:where ?: @""];
  _folder.identifier = @"folder";
  _folder.placeholderString = MVWord(@"A folder of .flow files");
  _folder.delegate = self;
  [_folder.widthAnchor constraintEqualToConstant:kFieldWide - 76].active = YES;
  _device = MVText(@"No device chosen", MVStyleBody);
  NSStackView *folder = [NSStackView stackViewWithViews:@[_folder, MVPlaceButton(@"Choose…", @"chooseFolder", self, @selector(chooseFolder:))]];
  NSGridView *grid = [NSGridView gridViewWithViews:@[@[MVText(@"App", MVStyleStrong), _app], @[MVText(@"Device", MVStyleStrong), _device], @[MVText(@"Folder", MVStyleStrong), folder]]];
  grid.rowSpacing = 8;
  grid.columnSpacing = 12;
  [grid columnAtIndex:0].xPlacement = NSGridCellPlacementTrailing;
  [self fillDevice:_shownDevice];
  // its own width: stretched to a column, what it does with the rest differs from one launch to the next
  NSView *held = [NSView new];
  grid.translatesAutoresizingMaskIntoConstraints = NO;
  [held addSubview:grid];
  [NSLayoutConstraint activateConstraints:@[
    [grid.topAnchor constraintEqualToAnchor:held.topAnchor],
    [grid.bottomAnchor constraintEqualToAnchor:held.bottomAnchor],
    [grid.leadingAnchor constraintEqualToAnchor:held.leadingAnchor],
    [grid.trailingAnchor constraintLessThanOrEqualToAnchor:held.trailingAnchor],
  ]];
  return MVCard(held, 12);
}

- (NSView *)rowFor:(NSArray<NSString *> *)about hue:(NSInteger)hue {
  MVToolRow *row = [[MVToolRow alloc] initWithAbout:about hue:hue owner:self run:@selector(rowClicked:) open:@selector(openClicked:)];
  _rows[about[0]] = row;
  if ([about[0] isEqual:@"clients-preview"]) _rows[@"clients"] = row;
  return row.view;
}

- (void)viewDidMoveToWindow {
  if (self.window) MVAskClients(@"apps", @{});
}

- (void)fillDevice:(nullable NSDictionary *)device {
  _shownDevice = device;
  _device.stringValue = device ? MVDeviceRow(device).title : MVWord(@"No device chosen");
  [self refreshRows];
}

- (void)showApps:(NSDictionary *)message {
  [_app removeAllItems];
  [_app addItemsWithObjectValues:message[@"apps"]];
  if (!_app.stringValue.length && [message[@"apps"] count]) _app.stringValue = [message[@"apps"] firstObject];
  [self refreshRows];
  if ([message[@"fromApp"] boolValue] == _fromApp) return;
  _fromApp = !_fromApp;
  [self build];
}

/// What a row lacks first, in a word.
- (nullable NSString *)lackOf:(MVToolRow *)row {
  if ([row.needs containsString:@"a"] && !_app.stringValue.length) return @"Needs an app";
  if ([row.needs containsString:@"d"] && !_shownDevice) return @"Needs a device";
  if ([row.needs containsString:@"f"] && !_folder.stringValue.length) return @"Needs a folder";
  return nil;
}

/// A row says for itself what it lacks.
- (void)refreshRows {
  for (MVToolRow *row in _rows.allValues) [row needs:row.running ? nil : [self lackOf:row]];
}

- (void)controlTextDidChange:(NSNotification *)notification {
  [self refreshRows];
}

- (void)comboBoxSelectionDidChange:(NSNotification *)notification {
  // the box takes its new word after this says so
  dispatch_async(dispatch_get_main_queue(), ^{
    [self refreshRows];
  });
}

- (void)rowClicked:(NSButton *)sender {
  NSString *name = [sender.identifier substringFromIndex:@"run:".length];
  MVToolRow *row = _rows[name];
  if (row.running) return MVAskClients(@"run", @{@"name": row.running, @"stop": @YES});
  if ([self lackOf:row]) return;
  NSMutableDictionary *asked = [@{@"name": row.armed ? @"clients" : name} mutableCopy];
  if (_app.stringValue.length) asked[@"app"] = _app.stringValue;
  if (_shownDevice) asked[@"device"] = _shownDevice[@"serial"] ?: _shownDevice[@"id"];
  if (_folder.stringValue.length) asked[@"folder"] = _folder.stringValue;
  if ([name isEqual:@"timeline"]) asked[@"seconds"] = @"30";
  MVAskClients(@"run", asked);
}

- (void)openClicked:(NSButton *)sender {
  NSString *file = _rows[[sender.identifier substringFromIndex:@"open:".length]].file;
  if (file) MVOpenOutside(file);
}

- (void)chooseFolder:(id)sender {
  // a panel takes the keyboard, which a window kept behind never does
  if (MVPlaceIsBehind()) return MVOpenOutside(@"folder panel");
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.canChooseDirectories = YES;
  panel.canChooseFiles = NO;
  [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse answer) {
    if (answer != NSModalResponseOK) return;
    self->_folder.stringValue = panel.URL.path;
    [self refreshRows];
  }];
}

- (void)heard:(NSDictionary *)run {
  MVToolRow *row = _rows[run[@"name"]];
  if (!row) return;
  if (run[@"started"]) [row began:run device:_shownDevice ? MVDeviceRow(_shownDevice).title : nil];
  if (run[@"text"]) [row heardText:run[@"text"]];
  if (run[@"line"]) [row heardText:[run[@"line"] stringByAppendingString:@"\n"]];
  if (!run[@"code"]) return;
  [row ended:run];
  [self refreshRows];
  BOOL good = [run[@"code"] intValue] == 0, stopped = [run[@"stopped"] boolValue];
  if (good && !stopped && [run[@"name"] isEqual:@"clients-preview"]) [row armAs:@"Add to All"];
  // a page asked for by name opens as it is done; any other waits for a click
  if (good && row.file && [run[@"name"] isEqual:@"dashboard"]) MVOpenOutside(row.file);
}

- (void)chooseApp:(NSString *)app folder:(NSString *)folder {
  _app.stringValue = app;
  _folder.stringValue = folder;
  [self refreshRows];
}

@end
