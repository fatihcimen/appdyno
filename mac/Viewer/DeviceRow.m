// A row of the Device pane: a condition by the op's name for it, its control, and what the parent last said of it, the
// device's state or why it cannot change it. What a person does with a control goes to the pane, which sends it.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kControlWide = 132, kChoiceWide = 164, kMark = 6;

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

/// A reason begun as a sentence, where its first word is no name that keeps its own case, as iOS does.
static NSString *capitalized(NSString *words) {
  NSString *first = [words componentsSeparatedByString:@" "].firstObject;
  if (!words.length || ![first isEqual:first.lowercaseString]) return words;
  return [[words substringToIndex:1].uppercaseString stringByAppendingString:[words substringFromIndex:1]];
}

/// A field on its plate, `wide` unless it takes what room is left.
static NSTextField *plated(NSTextField *field, double wide, NSMutableArray<NSView *> *views, NSMutableArray<NSControl *> *controls) {
  NSView *plate = MVFieldPlate(field, nil);
  if (wide > 0) [plate.widthAnchor constraintEqualToConstant:wide].active = YES;
  [views addObject:plate];
  [controls addObject:field];
  return field;
}

@interface MVConditionRow ()
@property(nonatomic) NSTextField *label, *note;
@property(nonatomic) MVInk *mark;
@property(nonatomic) NSArray<NSControl *> *controls;
@end

@implementation MVConditionRow

+ (NSArray<MVConditionRow *> *)rowsFor:(id<MVConditionTarget>)target {
  NSMutableArray *rows = [NSMutableArray array];
  for (int i = 0; i < kRowCount; i++) [rows addObject:[[MVConditionRow alloc] initAt:i target:target]];
  return rows;
}

- (instancetype)initAt:(int)i target:(id<MVConditionTarget>)target {
  if ((self = [super init])) {
    _name = @(kRows[i].name);
    _title = MVWord(@(kRows[i].title));
    _kind = kRows[i].kind;
    _heading = kRows[i].heading ? @(kRows[i].heading) : nil;
    _label = MVText(@(kRows[i].title), MVStyleBody);
    [_label setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    _mark = [[MVInk alloc] initWithSymbol:@"circle.fill" color:MVAccent() size:kMark];
    _mark.toolTip = MVWord(@"Changed here: it goes back when the device leaves this window");
    _mark.hidden = YES;
    [_mark.widthAnchor constraintEqualToConstant:kMark + 2].active = YES;
    NSArray<NSView *> *ends = [self controlsFor:target];
    // what takes more than one control has a line of its own under the label, but a message's sender, on the label's line
    NSUInteger onLine = _kind < MVRowLocation ? ends.count : _kind == MVRowSms ? 1
                                                                               : 0;
    NSView *gap = [NSView new];
    [gap setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    // the mark stands right after the words it marks, and the control at the line's end
    NSStackView *line = [NSStackView stackViewWithViews:[@[_label, _mark, gap] arrayByAddingObjectsFromArray:[ends subarrayWithRange:NSMakeRange(0, onLine)]]];
    line.spacing = 6;
    _note = MVPaneNote(@"");
    _note.hidden = YES;
    NSMutableArray<NSView *> *parts = [NSMutableArray arrayWithObject:line];
    if (onLine < ends.count) {
      NSStackView *under = [NSStackView stackViewWithViews:[ends subarrayWithRange:NSMakeRange(onLine, ends.count - onLine)]];
      under.spacing = 6;
      [parts addObject:under];
    }
    [parts addObject:_note];
    _view = MVPlaceColumn(parts, 4);
  }
  return self;
}

/// Its control, by its kind: one on the label's line, or a line of its own for what takes more than one.
- (NSArray<NSView *> *)controlsFor:(id<MVConditionTarget>)target {
  NSString *named = [@"condition:" stringByAppendingString:_name];
  NSMutableArray<NSView *> *views = [NSMutableArray array];
  NSMutableArray<NSControl *> *controls = [NSMutableArray array];
  void (^button)(NSString *, NSString *) = ^(NSString *title, NSString *what) {
    NSButton *pressed = MVPlaceButton(title, [NSString stringWithFormat:@"%@:%@", self->_name, what], target, @selector(pressed:));
    [views addObject:pressed];
    [controls addObject:pressed];
  };
  if (_kind == MVRowSwitch) {
    _control = [NSSwitch new];
    _control.action = @selector(switched:);
  } else if (_kind == MVRowChoice) {
    _control = [NSPopUpButton new];
    _control.action = @selector(chosen:);
    [_control.widthAnchor constraintEqualToConstant:kChoiceWide].active = YES;
  } else if (_kind == MVRowField) {
    NSString *hint = @{@"locale": @"tr-TR", @"proxy": @"host:port", @"battery": @"0–100"}[_name];
    _field = plated(MVSendField(named, hint, _title, target, @selector(typed:)), kControlWide, views, controls);
  } else if (_kind == MVRowLocation) {
    _field = plated(MVSendField(named, @"41.0082, 28.9784", @"Latitude, longitude", target, @selector(typed:)), 0, views, controls);
    button(@"Clear", @"clear");
  } else if (_kind == MVRowBiometric) {
    button(@"Match", @"match");
    button(@"No Match", @"nomatch");
  } else if (_kind == MVRowCall) {
    _field = plated(MVSendField(named, @"+15551234567", @"Phone number", target, @selector(typed:)), 0, views, controls);
    button(@"Call", @"call");
    button(@"End", @"end");
  } else {
    _from = plated(MVSendField([named stringByAppendingString:@":from"], @"From", @"From", target, @selector(typed:)), kControlWide, views, controls);
    _field = plated(MVSendField(named, @"Message", @"Message", target, @selector(typed:)), 0, views, controls);
    button(@"Send", @"send");
  }
  if (_control) {
    _control.target = target;
    _control.identifier = named;
    _control.accessibilityLabel = _title;
    [views addObject:_control];
    [controls addObject:_control];
  }
  _controls = controls;
  return views;
}

- (void)offerChoices:(BOOL)android {
  NSPopUpButton *choice = (NSPopUpButton *)_control;
  [choice removeAllItems];
  for (NSArray<NSString *> *option in choicesOf(_name, android)) {
    [choice addItemWithTitle:MVWord(option[1])];
    choice.lastItem.representedObject = option[0];
  }
}

- (BOOL)changed {
  return [_said[@"changed"] boolValue];
}

/// As the parent said it: its state, or why the device cannot change it, and whether it was changed here.
- (void)fill {
  NSString *why = [_said[@"why"] isKindOfClass:NSString.class] ? _said[@"why"] : @"";
  NSString *value = [_said[@"value"] isKindOfClass:NSString.class] ? _said[@"value"] : nil;
  _can = !why.length && (_kind >= MVRowLocation || value);
  _note.stringValue = MVWord(capitalized(why));
  _note.hidden = !why.length;
  _label.textColor = _can ? MVInkColor() : MVQuietColor();
  _mark.hidden = !self.changed;
  if (!value) return;
  if (_kind == MVRowSwitch) [(NSSwitch *)_control setState:[_said[@"on"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff];
  if (_kind == MVRowField) _field.stringValue = [_name isEqual:@"proxy"] && [value isEqual:@"none"] ? @"" : nowOf(value);
  if (_kind != MVRowChoice) return;
  NSPopUpButton *choice = (NSPopUpButton *)_control;
  for (NSInteger i = 0; i < choice.numberOfItems; i++)
    if (sameChoice([choice itemAtIndex:i].representedObject, value)) return [choice selectItemAtIndex:i];
  // what the device reads that no choice is, as it reads it
  [choice addItemWithTitle:nowOf(value)];
  choice.lastItem.representedObject = nowOf(value);
  [choice selectItem:choice.lastItem];
}

- (void)enable:(BOOL)on {
  for (NSControl *control in _controls) control.enabled = on && _can;
}

- (NSString *)state {
  if (_kind == MVRowSwitch) return MVWord([(NSSwitch *)_control state] == NSControlStateValueOn ? @"On" : @"Off");
  if (_kind == MVRowChoice) return [(NSPopUpButton *)_control titleOfSelectedItem] ?: @"";
  return _field.stringValue;
}

- (NSString *)shown {
  if (!_can) return [@"disabled: " stringByAppendingString:_note.stringValue];
  if (_kind == MVRowSwitch) return [(NSSwitch *)_control state] == NSControlStateValueOn ? @"on" : @"off";
  if (_kind == MVRowChoice) return [(NSPopUpButton *)_control selectedItem].representedObject ?: @"";
  return _field.stringValue ?: @"";
}

@end
