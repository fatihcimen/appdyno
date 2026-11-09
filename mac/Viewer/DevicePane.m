// The Device pane: the device's conditions as it reads them, each changed by `device_setting` or `set_location`, the ops an
// agent calls, so that one record holds what goes back, whoever changed it. What this device cannot do stands disabled with
// the device's own reason, and what a person changes here goes back when the device leaves the window.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBetween = 10, kControlWide = 132, kChoiceWide = 164, kFromWide = 96, kMark = 6, kHeadingGap = 18;

typedef NS_ENUM(NSInteger, MVRowKind) { MVRowSwitch,
                                        MVRowChoice,
                                        MVRowField,
                                        MVRowLocation,
                                        MVRowBiometric,
                                        MVRowCall,
                                        MVRowSms };

/// Each row by the op's name for it, under the heading it opens where it opens one.
static const struct {
  const char *name, *title;
  MVRowKind kind;
  const char *heading;
} kRows[] = {
    {"dark_mode", "Dark Mode", MVRowSwitch, "General"},
    {"text_size", "Text Size", MVRowChoice, NULL},
    {"locale", "Language and Region", MVRowField, NULL},
    {"reduce_motion", "Reduce Motion", MVRowSwitch, "Accessibility"},
    {"increase_contrast", "Increase Contrast", MVRowSwitch, NULL},
    {"reduce_transparency", "Reduce Transparency", MVRowSwitch, NULL},
    {"animations", "Animations", MVRowSwitch, NULL},
    {"network", "Network Speed", MVRowChoice, "Network"},
    {"wifi", "Wi-Fi", MVRowSwitch, NULL},
    {"mobile_data", "Mobile Data", MVRowSwitch, NULL},
    {"airplane", "Airplane Mode", MVRowSwitch, NULL},
    {"proxy", "Proxy", MVRowField, NULL},
    {"battery", "Battery Level", MVRowField, "Hardware"},
    {"thermal", "Thermal State", MVRowChoice, NULL},
    {"fold", "Fold", MVRowChoice, NULL},
    {"location", "Location", MVRowLocation, NULL},
    {"biometric", "Face ID or Fingerprint", MVRowBiometric, "Events"},
    {"call", "Incoming Call", MVRowCall, NULL},
    {"sms", "Text Message", MVRowSms, NULL},
};
enum { kRowCount = sizeof kRows / sizeof kRows[0] };

/// What a choice offers, as the op takes it and as a person reads it: a text size is a size on iOS and a scale on Android.
static NSArray<NSArray<NSString *> *> *choicesOf(NSString *name, BOOL android) {
  if ([name isEqual:@"network"]) return @[@[@"full", @"Full Speed"], @[@"slow", @"Slow (EDGE)"]];
  if ([name isEqual:@"fold"]) return @[@[@"open", @"Unfolded"], @[@"closed", @"Folded"]];
  if ([name isEqual:@"thermal"]) return @[@[@"nominal", @"Nominal"], @[@"fair", @"Fair"], @[@"serious", @"Serious"], @[@"critical", @"Critical"]];
  if (android) {
    NSMutableArray *scales = [NSMutableArray arrayWithObject:@[@"default", @"Default"]];
    for (NSString *scale in @[@"0.85", @"1.0", @"1.15", @"1.3", @"1.5", @"1.8", @"2.0"]) [scales addObject:@[scale, MVPercent(scale.doubleValue * 100)]];
    return scales;
  }
  return @[
    @[@"extra-small", @"Extra Small"], @[@"small", @"Small"], @[@"medium", @"Medium"], @[@"large", @"Large (Default)"], @[@"extra-large", @"Extra Large"],
    @[@"extra-extra-large", @"Extra Extra Large"], @[@"extra-extra-extra-large", @"Extra Extra Extra Large"], @[@"accessibility-medium", @"Accessibility Medium"],
    @[@"accessibility-large", @"Accessibility Large"], @[@"accessibility-extra-large", @"Accessibility Extra Large"],
    @[@"accessibility-extra-extra-large", @"Accessibility Extra Extra Large"], @[@"accessibility-extra-extra-extra-large", @"Accessibility Extra Extra Extra Large"]
  ];
}

/// What a device reads with its state of the moment after it, `default (now 85)`, as what that state is.
static NSString *nowOf(NSString *value) {
  if (![value hasPrefix:@"default (now "] || ![value hasSuffix:@")"]) return value;
  return [value substringWithRange:NSMakeRange(13, value.length - 14)];
}

/// A choice the device reads: as named, by its head (`full (-1)`), as a number (1.0 for 1), or by how its name ends (an
/// iPhone's thermal profile).
static BOOL sameChoice(NSString *choice, NSString *read) {
  NSString *head = [nowOf(read) componentsSeparatedByString:@" ("].firstObject;
  return [choice isEqual:head] || (choice.doubleValue > 0 && choice.doubleValue == head.doubleValue) || [head.lowercaseString hasSuffix:choice];
}

/// What takes the room a line has left.
static NSView *gap(void) {
  NSView *gap = [NSView new];
  [gap setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  return gap;
}

/// A reason begun as a sentence, where its first word is no name that keeps its own case, as iOS does.
static NSString *capitalized(NSString *words) {
  NSString *first = [words componentsSeparatedByString:@" "].firstObject;
  if (!words.length || ![first isEqual:first.lowercaseString]) return words;
  return [[words substringToIndex:1].uppercaseString stringByAppendingString:[words substringFromIndex:1]];
}

/// One row of the pane, and what the parent last said of it.
@interface MVConditionRow : NSObject
@property(nonatomic, copy) NSString *name, *title;
@property(nonatomic) MVRowKind kind;
@property(nonatomic) NSView *view;
@property(nonatomic) NSTextField *label, *note;
@property(nonatomic, nullable) NSTextField *field, *from;
@property(nonatomic, nullable) NSControl *control;
@property(nonatomic) NSArray<NSControl *> *controls;
@property(nonatomic) MVInk *mark;
@property(nonatomic, copy, nullable) NSDictionary *said;
@property(nonatomic) BOOL can;
@end

@implementation MVConditionRow
@end

/// The rows' column, from its top.
@interface MVDeviceColumn : NSView
@end

@implementation MVDeviceColumn
- (BOOL)isFlipped {
  return YES;
}
@end

@implementation MVDevicePane {
  NSMutableDictionary<NSString *, MVConditionRow *> *_rows;
  NSTextField *_reading;
  NSButton *_back;
  NSDictionary *_asked;
  NSSet<NSString *> *_changedBefore;
  BOOL _android;
}

@synthesize onSend = _onSend, answer = _answer;

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _rows = [NSMutableDictionary dictionary];
    _reading = MVPaneNote(@"Reading the device");
    NSTextField *back = MVPaneNote(@"What you change here goes back when the device leaves this window.");
    NSStackView *column = MVPlaceColumn(@[back, _reading], 8);
    [column setCustomSpacing:kHeadingGap afterView:back];
    for (int i = 0; i < kRowCount; i++) {
      MVConditionRow *row = [self rowAt:i];
      _rows[row.name] = row;
      if (kRows[i].heading) {
        // a heading stands nearer what it heads than what went before
        [column setCustomSpacing:kHeadingGap afterView:column.arrangedSubviews.lastObject];
        NSTextField *heading = MVPaneHeading(@(kRows[i].heading));
        [column addArrangedSubview:heading];
        [column setCustomSpacing:6 afterView:heading];
      }
      [column addArrangedSubview:row.view];
    }
    NSScrollView *scroll = [self scrolling:column];
    _answer = [MVAnswerView new];
    _back = MVPlaceButton(@"Put Back All", @"deviceBack", self, @selector(putBack:));
    // the pane's one button, at its trailing edge, as a sheet's are
    NSStackView *foot = MVPlaceColumn(@[MVSeparator(), _answer, [NSStackView stackViewWithViews:@[gap(), _back]]], 8);
    for (NSView *part in @[scroll, foot]) {
      part.translatesAutoresizingMaskIntoConstraints = NO;
      [self addSubview:part];
      [part.leadingAnchor constraintEqualToAnchor:self.leadingAnchor].active = YES;
      [part.trailingAnchor constraintEqualToAnchor:self.trailingAnchor].active = YES;
    }
    [NSLayoutConstraint activateConstraints:@[
      [scroll.topAnchor constraintEqualToAnchor:self.topAnchor],
      [foot.topAnchor constraintEqualToAnchor:scroll.bottomAnchor
                                     constant:kBetween],
      [foot.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
    ]];
    [self enable:NO];
  }
  return self;
}

/// The column in what room the pane has, scrolled when it runs past it, as wide as the pane.
- (NSScrollView *)scrolling:(NSView *)column {
  NSScrollView *scroll = [NSScrollView new];
  scroll.drawsBackground = NO;
  scroll.hasVerticalScroller = YES;
  scroll.autohidesScrollers = YES;
  NSView *page = [MVDeviceColumn new];
  page.translatesAutoresizingMaskIntoConstraints = NO;
  column.translatesAutoresizingMaskIntoConstraints = NO;
  [page addSubview:column];
  scroll.documentView = page;
  NSClipView *clip = scroll.contentView;
  [NSLayoutConstraint activateConstraints:@[
    [page.topAnchor constraintEqualToAnchor:clip.topAnchor],
    [page.leadingAnchor constraintEqualToAnchor:clip.leadingAnchor],
    [page.widthAnchor constraintEqualToAnchor:clip.widthAnchor],
    [column.topAnchor constraintEqualToAnchor:page.topAnchor],
    [column.leadingAnchor constraintEqualToAnchor:page.leadingAnchor],
    [column.trailingAnchor constraintEqualToAnchor:page.trailingAnchor],
    [column.bottomAnchor constraintEqualToAnchor:page.bottomAnchor],
  ]];
  return scroll;
}

/// A field on its plate, `wide` unless it takes what room is left.
static NSTextField *plated(NSTextField *field, double wide, NSMutableArray<NSView *> *views, NSMutableArray<NSControl *> *controls) {
  NSView *plate = MVFieldPlate(field, nil);
  if (wide > 0) [plate.widthAnchor constraintEqualToConstant:wide].active = YES;
  [views addObject:plate];
  [controls addObject:field];
  return field;
}

/// A row's control, by its kind: one on the label's line, or a line of its own for what takes more than one.
- (NSArray<NSView *> *)controlsOf:(MVConditionRow *)row {
  NSString *name = row.name, *named = [@"condition:" stringByAppendingString:name];
  NSMutableArray<NSView *> *views = [NSMutableArray array];
  NSMutableArray<NSControl *> *controls = [NSMutableArray array];
  void (^button)(NSString *, NSString *) = ^(NSString *title, NSString *what) {
    NSButton *pressed = MVPlaceButton(title, [NSString stringWithFormat:@"%@:%@", name, what], self, @selector(pressed:));
    [views addObject:pressed];
    [controls addObject:pressed];
  };
  switch (row.kind) {
    case MVRowSwitch: {
      NSSwitch *toggle = [NSSwitch new];
      toggle.target = self;
      toggle.action = @selector(switched:);
      row.control = toggle;
      break;
    }
    case MVRowChoice: {
      NSPopUpButton *choice = [NSPopUpButton new];
      choice.target = self;
      choice.action = @selector(chosen:);
      [choice.widthAnchor constraintEqualToConstant:kChoiceWide].active = YES;
      row.control = choice;
      break;
    }
    case MVRowField: {
      NSString *hint = @{@"locale": @"tr-TR", @"proxy": @"host:port", @"battery": @"0–100"}[name];
      row.field = plated(MVSendField(named, hint, row.title, self, @selector(typed:)), kControlWide, views, controls);
      break;
    }
    case MVRowLocation:
      row.field = plated(MVSendField(named, @"41.0082, 28.9784", @"Latitude, longitude", self, @selector(typed:)), 0, views, controls);
      button(@"Clear", @"clear");
      break;
    case MVRowBiometric:
      button(@"Match", @"match");
      button(@"No Match", @"nomatch");
      break;
    case MVRowCall:
      row.field = plated(MVSendField(named, @"+15551234567", @"Phone number", self, @selector(typed:)), 0, views, controls);
      button(@"Call", @"call");
      button(@"End", @"end");
      break;
    case MVRowSms:
      row.from = plated(MVSendField([named stringByAppendingString:@":from"], @"From", @"From", self, @selector(typed:)), kFromWide, views, controls);
      row.field = plated(MVSendField(named, @"Message", @"Message", self, @selector(typed:)), 0, views, controls);
      button(@"Send", @"send");
      break;
  }
  if (row.control) {
    row.control.identifier = named;
    row.control.accessibilityLabel = row.title;
    [views addObject:row.control];
    [controls addObject:row.control];
  }
  row.controls = controls;
  return views;
}

- (MVConditionRow *)rowAt:(int)i {
  MVConditionRow *row = [MVConditionRow new];
  row.name = @(kRows[i].name);
  row.title = MVWord(@(kRows[i].title));
  row.kind = kRows[i].kind;
  row.label = MVText(@(kRows[i].title), MVStyleBody);
  [row.label setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  row.mark = [[MVInk alloc] initWithSymbol:@"circle.fill" color:MVAccent() size:kMark];
  row.mark.toolTip = MVWord(@"Changed here: it goes back when the device leaves this window");
  row.mark.hidden = YES;
  [row.mark.widthAnchor constraintEqualToConstant:kMark + 2].active = YES;
  NSArray<NSView *> *ends = [self controlsOf:row];
  BOOL own = row.kind >= MVRowLocation;
  // the mark stands right after the words it marks, and the control at the line's end
  NSStackView *line = [NSStackView stackViewWithViews:[@[row.label, row.mark, gap()] arrayByAddingObjectsFromArray:own ? @[] : ends]];
  line.spacing = 6;
  row.note = MVPaneNote(@"");
  row.note.hidden = YES;
  NSMutableArray<NSView *> *parts = [NSMutableArray arrayWithObject:line];
  if (own) {
    NSStackView *under = [NSStackView stackViewWithViews:ends];
    under.spacing = 6;
    [parts addObject:under];
  }
  [parts addObject:row.note];
  row.view = MVPlaceColumn(parts, 4);
  return row;
}

/// Every condition as the device reads it now, asked again each time the pane shows: an agent may have changed any.
- (void)ask {
  MVPaneSend(self, @{@"op": @"control", @"name": @"deviceList"});
}

/// Nothing here takes the keyboard first: a switch needs none.
- (void)focus {
}

- (void)setPlatform:(NSString *)platform {
  BOOL android = [platform isEqual:@"android"];
  if (android == _android && [(NSPopUpButton *)_rows[@"text_size"].control numberOfItems]) return;
  _android = android;
  for (MVConditionRow *row in _rows.allValues) {
    if (row.kind != MVRowChoice) continue;
    NSPopUpButton *choice = (NSPopUpButton *)row.control;
    [choice removeAllItems];
    for (NSArray<NSString *> *option in choicesOf(row.name, android)) {
      [choice addItemWithTitle:MVWord(option[1])];
      choice.lastItem.representedObject = option[0];
    }
  }
}

- (void)show:(NSDictionary *)m {
  if ([m[@"platform"] isKindOfClass:NSString.class]) [self setPlatform:m[@"platform"]];
  for (NSDictionary *said in [m[@"conditions"] isKindOfClass:NSArray.class] ? m[@"conditions"] : @[])
    if ([said isKindOfClass:NSDictionary.class]) _rows[said[@"name"]].said = said;
  // every control back to what the device last read: one a person moved while another change was on its way too
  for (MVConditionRow *row in _rows.allValues) [self fill:row];
  if (m[@"conditions"]) _reading.hidden = YES;
  NSDictionary *asked = _asked;
  if (m[@"ok"]) _asked = nil;
  [_answer show:[m[@"ok"] boolValue] && asked ? [self done:asked said:m] : m];
  [self enable:!_answer.waiting];
}

/// What a person reads of a row's state: the words of its switch or choice, or what its field holds.
- (NSString *)stateOf:(MVConditionRow *)row {
  if (row.kind == MVRowSwitch) return MVWord([(NSSwitch *)row.control state] == NSControlStateValueOn ? @"On" : @"Off");
  if (row.kind == MVRowChoice) return [(NSPopUpButton *)row.control titleOfSelectedItem] ?: @"";
  return row.field.stringValue;
}

/// What was done, in a person's words; the op's own stay for what went wrong.
- (NSDictionary *)done:(NSDictionary *)asked said:(NSDictionary *)m {
  NSMutableDictionary *said = [m mutableCopy];
  MVConditionRow *row = _rows[asked[@"name"]];
  NSString *value = asked[@"value"];
  NSString *words = nil;
  if ([asked[@"what"] isEqual:@"deviceRestore"]) {
    NSMutableArray<NSString *> *back = [NSMutableArray array];
    for (int i = 0; i < kRowCount; i++)
      if ([_changedBefore containsObject:@(kRows[i].name)] && ![_rows[@(kRows[i].name)].said[@"changed"] boolValue]) [back addObject:_rows[@(kRows[i].name)].title];
    BOOL left = NO;
    for (MVConditionRow *each in _rows.allValues) left = left || [each.said[@"changed"] boolValue];
    // what could not go back, or another program's, is said by the op whole
    if (left) return m;
    words = back.count ? MVFormat(@"Put back: %@", @[[back componentsJoinedByString:@", "]]) : MVWord(@"Nothing here was changed");
  } else if ([asked[@"what"] isEqual:@"deviceLocation"])
    words = MVWord(value ? @"The location is the real one again" : @"The location is set");
  else if (row.kind == MVRowBiometric)
    words = MVWord([value isEqual:@"match"] ? @"Answered with a match" : @"Answered with no match");
  else if (row.kind == MVRowCall)
    words = MVFormat([value hasPrefix:@"end "] ? @"The call from %@ ended" : @"A call from %@ is coming in", @[asked[@"number"] ?: @""]);
  else if (row.kind == MVRowSms)
    words = MVWord(@"The message came in");
  else
    words = MVFormat([m[@"moved"] boolValue] ? @"%@ is now %@" : @"%@ already reads %@", @[row.title, [self stateOf:row]]);
  said[@"text"] = words;
  [said removeObjectForKey:@"hint"];
  return said;
}

/// A row as the parent said it: its state, or why the device cannot change it, and whether it was changed here.
- (void)fill:(MVConditionRow *)row {
  NSDictionary *said = row.said;
  NSString *why = [said[@"why"] isKindOfClass:NSString.class] ? said[@"why"] : @"";
  NSString *value = [said[@"value"] isKindOfClass:NSString.class] ? said[@"value"] : nil;
  row.can = !why.length && (row.kind >= MVRowLocation || value);
  row.note.stringValue = MVWord(capitalized(why));
  row.note.hidden = !why.length;
  row.label.textColor = row.can ? MVInkColor() : MVQuietColor();
  row.mark.hidden = ![said[@"changed"] boolValue];
  if (!value) return;
  if (row.kind == MVRowSwitch) [(NSSwitch *)row.control setState:[said[@"on"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff];
  if (row.kind == MVRowField) row.field.stringValue = [row.name isEqual:@"proxy"] && [value isEqual:@"none"] ? @"" : nowOf(value);
  if (row.kind != MVRowChoice) return;
  NSPopUpButton *choice = (NSPopUpButton *)row.control;
  for (NSInteger i = 0; i < choice.numberOfItems; i++)
    if (sameChoice([choice itemAtIndex:i].representedObject, value)) return [choice selectItemAtIndex:i];
  // what the device reads that no choice is, as it reads it
  [choice addItemWithTitle:nowOf(value)];
  choice.lastItem.representedObject = nowOf(value);
  [choice selectItem:choice.lastItem];
}

/// One change at a time, each control standing as the device last read it until its answer comes.
- (void)enable:(BOOL)on {
  BOOL changed = NO;
  for (MVConditionRow *row in _rows.allValues) {
    for (NSControl *control in row.controls) control.enabled = on && row.can;
    changed = changed || [row.said[@"changed"] boolValue];
  }
  _back.enabled = on && changed;
}

- (void)send:(NSString *)what args:(NSDictionary *)args asked:(NSDictionary *)asked saying:(NSString *)words {
  if (_answer.waiting) return;
  NSMutableDictionary *all = [asked mutableCopy];
  all[@"what"] = what;
  _asked = all;
  [self enable:NO];
  [_answer sending:words];
  MVPaneSend(self, @{@"op": @"control", @"name": what, @"args": args});
}

- (MVConditionRow *)rowOf:(NSControl *)control {
  NSArray<NSString *> *parts = [control.identifier componentsSeparatedByString:@":"];
  return _rows[parts.count > 1 && [parts[0] isEqual:@"condition"] ? parts[1] : parts.firstObject];
}

/// A condition to a value, as the op takes it.
- (void)set:(MVConditionRow *)row value:(NSString *)value {
  [self send:@"deviceSet" args:@{@"name": row.name, @"value": value} asked:@{@"name": row.name, @"value": value} saying:MVFormat(@"Setting %@", @[row.title])];
}

- (void)switched:(NSSwitch *)sender {
  [self set:[self rowOf:sender] value:sender.state == NSControlStateValueOn ? @"on" : @"off"];
}

- (void)chosen:(NSPopUpButton *)sender {
  [self set:[self rowOf:sender] value:sender.selectedItem.representedObject ?: @""];
}

- (void)typed:(NSTextField *)sender {
  MVConditionRow *row = [self rowOf:sender];
  NSString *text = [row.field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (row.kind == MVRowField) return [self set:row value:text.length || ![row.name isEqual:@"proxy"] ? text : @"none"];
  if (row.kind == MVRowLocation) return [self locate:text];
  if (row.kind == MVRowCall) return [self call:text end:NO];
  [self message];
}

- (void)pressed:(NSButton *)sender {
  MVConditionRow *row = [self rowOf:sender];
  NSString *what = [sender.identifier componentsSeparatedByString:@":"].lastObject;
  NSString *number = [row.field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  if (row.kind == MVRowBiometric)
    [self send:@"deviceSet" args:@{@"name": @"biometric", @"value": what} asked:@{@"name": row.name, @"value": what} saying:MVWord([NSString stringWithFormat:@"Sending %@", sender.title])];
  else if (row.kind == MVRowLocation)
    [self send:@"deviceLocation" args:@{@"clear": @YES} asked:@{@"name": row.name, @"value": @"clear"} saying:MVWord(@"Setting the location")];
  else if (row.kind == MVRowCall)
    [self call:number end:[what isEqual:@"end"]];
  else
    [self message];
}

/// A place by its latitude and longitude, as a map writes them.
- (void)locate:(NSString *)text {
  NSArray<NSString *> *parts = [text componentsSeparatedByString:@","];
  NSNumberFormatter *number = [NSNumberFormatter new];
  number.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  NSNumber *lat = parts.count == 2 ? [number numberFromString:[parts[0] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]] : nil;
  NSNumber *lon = parts.count == 2 ? [number numberFromString:[parts[1] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]] : nil;
  if (!lat || !lon) return [_answer show:@{@"ok": @NO, @"text": MVWord(@"Give a latitude and a longitude, such as 41.0082, 28.9784")}];
  [self send:@"deviceLocation" args:@{@"lat": lat, @"lon": lon} asked:@{@"name": @"location"} saying:MVWord(@"Setting the location")];
}

- (void)call:(NSString *)number end:(BOOL)end {
  NSString *value = end ? [@"end " stringByAppendingString:number] : number;
  [self send:@"deviceSet" args:@{@"name": @"call", @"value": value} asked:@{@"name": @"call", @"value": value, @"number": number} saying:MVWord([NSString stringWithFormat:@"Sending %@", _rows[@"call"].title])];
}

- (void)message {
  MVConditionRow *row = _rows[@"sms"];
  NSString *from = [row.from.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  NSMutableDictionary *args = [NSMutableDictionary dictionaryWithDictionary:@{@"name": @"sms", @"value": row.field.stringValue}];
  if (from.length) args[@"title"] = from;
  [self send:@"deviceSet" args:args asked:@{@"name": @"sms"} saying:MVWord([NSString stringWithFormat:@"Sending %@", row.title])];
}

/// Everything this session changed, by `device_setting restore`: what another program changed stays, as it puts it back.
- (void)putBack:(id)sender {
  NSMutableSet<NSString *> *changed = [NSMutableSet set];
  for (MVConditionRow *row in _rows.allValues)
    if ([row.said[@"changed"] boolValue]) [changed addObject:row.name];
  _changedBefore = changed;
  [self send:@"deviceRestore" args:@{} asked:@{} saying:MVWord(@"Putting back what changed")];
}

- (void)set:(NSString *)name to:(NSString *)value {
  MVConditionRow *row = _rows[name];
  if (row.kind == MVRowSwitch) {
    [(NSSwitch *)row.control setState:[value isEqual:@"on"] ? NSControlStateValueOn : NSControlStateValueOff];
    return [self switched:(NSSwitch *)row.control];
  }
  if (row.kind == MVRowChoice) {
    NSPopUpButton *choice = (NSPopUpButton *)row.control;
    NSInteger at = [choice indexOfItemWithRepresentedObject:value];
    if (at >= 0) [choice selectItemAtIndex:at];
    return [self chosen:choice];
  }
  row.field.stringValue = value;
  [self typed:row.field];
}

- (NSString *)shown:(NSString *)name {
  MVConditionRow *row = _rows[name];
  if (!row.can) return [@"disabled: " stringByAppendingString:row.note.stringValue];
  if (row.kind == MVRowSwitch) return [(NSSwitch *)row.control state] == NSControlStateValueOn ? @"on" : @"off";
  if (row.kind == MVRowChoice) return [(NSPopUpButton *)row.control selectedItem].representedObject ?: @"";
  return row.field.stringValue ?: @"";
}

@end
