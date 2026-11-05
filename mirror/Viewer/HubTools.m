// Tools: what appdyno does at a terminal, from the window. Each row is a command of the parent's own table, run by the parent
// as a person would run it: what comes back is what it said, and how it ended in words.
#import "HubParts.h"
#import "Window.h"
#import "Words.h"

static const double kShowSeconds = 0.2;
static const NSUInteger kLinesShown = 10;
static const double kFieldWide = 300, kRowLeast = 48;

/// A row: the command's name, its title, what it does, and what it cannot run without.
static NSArray<NSDictionary *> *sections(BOOL fromApp) {
  NSMutableArray *mac = [@[
    @[@"tools", @"Get Trace Tools", @"Download what frame timelines need.", @""],
    @[@"clients-preview", @"Add to All AI Clients", @"Show the lines first, then add this server to each client.", @""],
    @[@"update-check", @"Check for Updates", @"Look for a newer release, and change nothing.", @""],
    @[@"update", @"Update", @"Move to the latest release, verified before anything changes.", @""],
  ] mutableCopy];
  if (fromApp) {
    [mac insertObject:@[@"path-on", @"Add to PATH", @"Put this appdyno on the PATH of every shell.", @""] atIndex:2];
    [mac insertObject:@[@"path-off", @"Take off PATH", @"Take this appdyno off the PATH again.", @""] atIndex:3];
  }
  return @[
    @{@"title": @"Performance Gate", @"rows": @[
      @[@"baseline", @"Save as Baseline", @"Keep the newest runs as what later ones are compared with.", @"a"],
      @[@"compare", @"Compare with Baseline", @"Say whether the newest runs got worse.", @"a"],
      @[@"why", @"Find Out Why", @"Find a regression's cause on the device.", @"a"],
      @[@"survey", @"Measure Everything", @"Run every measure on the device in turn, then write the page.", @"ad"],
    ]},
    @{@"title": @"Flows", @"rows": @[@[@"flows", @"Run Flows", @"Replay every flow in the folder on the device.", @"df"]]},
    @{@"title": @"Record", @"rows": @[
      @[@"timeline", @"Timeline", @"Keep video, touches, frames and requests on one clock for 30 s.", @"ad"],
      @[@"flight", @"Flight Recorder", @"Keep the last seconds of the app, saved on a crash or a stall, until you stop it.", @"ad"],
    ]},
    @{@"title": @"Reports", @"rows": @[@[@"dashboard", @"Dashboard", @"Write one page of what was measured, and open it.", @""]]},
    @{@"title": @"This Mac", @"rows": mac},
  ];
}

/// What a command's end means, in a person's words: only the gate and a test have more to say than that it ended.
static NSString *endWords(NSDictionary *run) {
  int code = [run[@"code"] intValue];
  NSString *name = run[@"name"];
  if ([run[@"stopped"] boolValue]) return @"Stopped";
  BOOL gate = [name isEqual:@"compare"] || [name isEqual:@"why"], tests = [name isEqual:@"flows"];
  if (code == 0) return gate ? @"No regression" : tests ? @"All passed" : @"Done";
  if (code == 1 && gate) return @"Regression found";
  return code == 1 && tests ? @"Some failed" : @"It failed: see what it said.";
}

@interface MVToolRow : NSObject
@property(nonatomic) NSView *view;
@property(nonatomic) NSButton *button, *open, *follow;
@property(nonatomic) NSStackView *below;
@property(nonatomic) MVInk *mark;
@property(nonatomic) NSTextField *status, *output;
@property(nonatomic, copy) NSString *needs, *running, *file;
@property(nonatomic) NSMutableString *said;
@end

@implementation MVToolRow
@end

@implementation MVToolsPane {
  NSMutableDictionary<NSString *, MVToolRow *> *_rows;
  NSComboBox *_app;
  NSTextField *_folder, *_device;
  NSStackView *_column;
  NSDictionary *_shownDevice;
  BOOL _fromApp;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _column = MVPlaceColumn(@[], 16);
    NSScrollView *page = MVPlacePage(_column);
    page.frame = self.bounds;
    page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:page];
    [self build];
  }
  return self;
}

- (void)build {
  for (NSView *view in _column.arrangedSubviews) [view removeFromSuperview];
  _rows = [NSMutableDictionary dictionary];
  [_column addArrangedSubview:MVParagraph(@"What you can run from here is what appdyno can do at a terminal, and each row says the command.", MVStyleBody)];
  [_column addArrangedSubview:[self subjectCard]];
  for (NSDictionary *section in sections(_fromApp)) {
    NSStackView *rows = MVPlaceColumn(@[], 0);
    for (NSArray<NSString *> *row in section[@"rows"]) {
      if (rows.arrangedSubviews.count) [rows addArrangedSubview:MVSeparator()];
      [rows addArrangedSubview:[self rowFor:row]];
    }
    [_column addArrangedSubview:MVPlaceColumn(@[MVText(section[@"title"], MVStyleHeading), MVCard(rows, 0)], 6)];
  }
}

/// What the rows run on: one app, one device and one folder, chosen once for all of them.
- (NSView *)subjectCard {
  NSString *kept = _app.stringValue;
  _app = [NSComboBox new];
  _app.identifier = @"app";
  _app.stringValue = kept ?: MVFrontApp() ?: @"";
  [_app.widthAnchor constraintEqualToConstant:kFieldWide].active = YES;
  NSString *where = _folder.stringValue;
  _folder = [NSTextField textFieldWithString:where ?: @""];
  _folder.identifier = @"folder";
  [_folder.widthAnchor constraintEqualToConstant:kFieldWide - 76].active = YES;
  _device = MVText(@"No device chosen", MVStyleBody);
  NSStackView *folder = [NSStackView stackViewWithViews:@[_folder, MVPlaceButton(@"Choose…", @"chooseFolder", self, @selector(chooseFolder:))]];
  NSGridView *grid = [NSGridView gridViewWithViews:@[@[MVText(@"App", MVStyleStrong), _app], @[MVText(@"Device", MVStyleStrong), _device], @[MVText(@"Folder", MVStyleStrong), folder]]];
  grid.rowSpacing = 8;
  grid.columnSpacing = 12;
  [grid columnAtIndex:0].xPlacement = NSGridCellPlacementTrailing;
  [self fillDevice:_shownDevice];
  return MVCard(grid, 12);
}

- (NSView *)rowFor:(NSArray<NSString *> *)about {
  NSString *name = about[0];
  MVToolRow *row = [MVToolRow new];
  row.needs = about[3];
  row.button = MVPlaceButton(@"Run", [@"run:" stringByAppendingString:name], self, @selector(rowClicked:));
  row.open = MVPlaceButton(@"Open", [@"open:" stringByAppendingString:name], self, @selector(openClicked:));
  row.open.hidden = YES;
  NSMutableArray<NSView *> *ends = [NSMutableArray arrayWithObject:row.open];
  if ([name isEqual:@"clients-preview"]) {
    row.follow = MVPlacePrimary(@"Add to All", @"run:clients", self, @selector(rowClicked:));
    row.follow.hidden = YES;
    [ends addObject:row.follow];
    _rows[@"clients"] = row;
  }
  [ends addObject:row.button];
  NSView *top = MVPlaceRow(MVPlaceColumn(@[MVText(about[1], MVStyleBody), MVParagraph(about[2], MVStyleSub)], 1), ends);
  [top.heightAnchor constraintGreaterThanOrEqualToConstant:kRowLeast].active = YES;
  row.mark = [[MVInk alloc] initWithSymbol:@"circle" color:MVQuietColor() size:12];
  [row.mark.widthAnchor constraintEqualToConstant:16].active = YES;
  row.status = MVParagraph(@"", MVStyleCallout);
  NSStackView *line = [NSStackView stackViewWithViews:@[row.mark, row.status]];
  line.spacing = 6;
  row.output = MVCodeText(@"");
  row.below = MVPlaceColumn(@[line, MVCard(row.output, 8)], 4);
  row.below.hidden = YES;
  row.below.edgeInsets = NSEdgeInsetsMake(0, 0, 10, 0);
  _rows[name] = row;
  row.view = MVPlaceColumn(@[top, row.below], 4);
  return row.view;
}

- (void)viewDidMoveToWindow {
  if (self.window) MVAskClients(@"apps", @{});
}

- (void)fillDevice:(nullable NSDictionary *)device {
  _shownDevice = device;
  _device.stringValue = device ? MVDeviceRow(device).title : MVWord(@"No device chosen");
}

- (void)showApps:(NSDictionary *)message {
  [_app removeAllItems];
  [_app addItemsWithObjectValues:message[@"apps"]];
  if (!_app.stringValue.length && [message[@"apps"] count]) _app.stringValue = [message[@"apps"] firstObject];
  if ([message[@"fromApp"] boolValue] == _fromApp) return;
  _fromApp = !_fromApp;
  [self build];
}

- (nullable NSString *)missingFor:(MVToolRow *)row {
  if ([row.needs containsString:@"a"] && !_app.stringValue.length) return @"Choose an app first.";
  if ([row.needs containsString:@"d"] && !_shownDevice) return @"Choose a device first.";
  if ([row.needs containsString:@"f"] && !_folder.stringValue.length) return @"Choose a folder first.";
  return nil;
}

- (void)tell:(MVToolRow *)row word:(NSString *)word symbol:(NSString *)symbol color:(NSColor *)color {
  BOOL fresh = row.below.hidden;
  row.below.hidden = NO;
  [row.mark paint:symbol color:color];
  row.status.stringValue = MVWord(word);
  if (!fresh) return;
  row.below.wantsLayer = YES;
  MVFade(row.below.layer, 0, 1, kShowSeconds);
}

- (void)rowClicked:(NSButton *)sender {
  NSString *name = [sender.identifier substringFromIndex:@"run:".length];
  MVToolRow *row = _rows[name];
  if (row.running) return MVAskClients(@"run", @{@"name": row.running, @"stop": @YES});
  NSString *missing = [self missingFor:row];
  if (missing) return [self tell:row word:missing symbol:@"exclamationmark.triangle.fill" color:MVOrange()];
  NSMutableDictionary *asked = [@{@"name": name} mutableCopy];
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
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.canChooseDirectories = YES;
  panel.canChooseFiles = NO;
  [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse answer) {
    if (answer == NSModalResponseOK) self->_folder.stringValue = panel.URL.path;
  }];
}

- (void)heard:(NSDictionary *)run {
  MVToolRow *row = _rows[run[@"name"]];
  if (!row) return;
  if (run[@"started"]) {
    row.running = run[@"name"];
    row.said = [NSMutableString stringWithFormat:@"$ %@\n", run[@"command"]];
    row.file = nil;
    row.open.hidden = row.follow.hidden = YES;
    row.button.title = MVWord(@"Stop");
    [self tell:row word:@"Running…" symbol:@"circle.dotted" color:MVQuietColor()];
  }
  if (run[@"text"]) [row.said appendString:run[@"text"]];
  if (run[@"line"]) row.said = [NSMutableString stringWithFormat:@"%@\n", run[@"line"]];
  if (row.said) {
    NSArray<NSString *> *lines = [[row.said stringByTrimmingCharactersInSet:NSCharacterSet.newlineCharacterSet] componentsSeparatedByString:@"\n"];
    NSUInteger from = lines.count > kLinesShown ? lines.count - kLinesShown : 0;
    row.output.stringValue = [[lines subarrayWithRange:NSMakeRange(from, lines.count - from)] componentsJoinedByString:@"\n"];
  }
  if (run[@"code"]) [self ended:row run:run];
}

- (void)ended:(MVToolRow *)row run:(NSDictionary *)run {
  row.running = nil;
  row.button.title = MVWord(@"Run");
  NSString *word = endWords(run);
  BOOL good = [run[@"code"] intValue] == 0, stopped = [run[@"stopped"] boolValue];
  [self tell:row word:word symbol:stopped ? @"stop.circle" : good ? @"checkmark.circle.fill" : @"xmark.octagon.fill" color:stopped ? MVQuietColor() : good ? MVGreen() : NSColor.systemRedColor];
  MVAnnounce(word);
  row.file = run[@"file"];
  row.open.hidden = !row.file;
  row.follow.hidden = !(good && !stopped && [run[@"name"] isEqual:@"clients-preview"]);
  // a page asked for by name opens as it is done; any other waits for a click
  if (good && row.file && [run[@"name"] isEqual:@"dashboard"]) MVOpenOutside(row.file);
}

- (nullable NSString *)appChosen {
  return _app.stringValue;
}

- (void)chooseApp:(NSString *)app folder:(NSString *)folder {
  _app.stringValue = app;
  _folder.stringValue = folder;
}

@end
