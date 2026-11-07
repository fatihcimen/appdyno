// The Push pane in a window kept behind: what the op says a device takes, the fields that follow the type, the payload
// to start from, what a send carries, and an answer shown whole.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

static NSDictionary *typesSaid(void) {
  return @{@"op": @"answer", @"name": @"push", @"app": @"dev.app", @"types": @[
    @{@"type": @"alert", @"route": @"simctl push", @"fields": @[@"title", @"body", @"data"], @"template": @"{\"aps\":{\"alert\":{\"title\":\"T\"}}}"},
    @{@"type": @"background", @"why": @"simctl takes no push with nothing to see"},
    @{@"type": @"rich", @"route": @"simctl push with mutable-content", @"fields": @[@"title", @"body", @"image", @"data"], @"template": @"{\"aps\":{\"mutable-content\":1},\"image\":\"I\"}"},
  ]};
}

void MVCheckPush(void) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": @"push", @"look": @{@"controls": @[@"home"]}}];
  [window.nsWindow setContentSize:NSMakeSize(1200, 800)];
  MVPushPane *pane = window.inspector.push;
  NSMutableArray<NSDictionary *> *sent = [NSMutableArray array];
  pane.onSend = ^(NSDictionary *message) {
    [sent addObject:message];
  };
  [window pokeMenu:@"push"];
  MVPump(0.3);
  MVCheck(@"push: Send Push in More shows the pane, and asks what this device takes", window.inspecting && window.inspector.chosen == MVPanePush && [sent.lastObject[@"name"] isEqual:@"pushes"], sent.description);
  [pane show:typesSaid()];
  NSPopUpButton *type = [pane valueForKey:@"_type"];
  NSTextField *app = [pane valueForKey:@"_app"];
  MVCheck(@"push: the window's app stands in its field", [app.stringValue isEqual:@"dev.app"], app.stringValue);
  MVCheck(@"push: a type the device does not take is there, and cannot be chosen, with why", type.numberOfItems == 3 && ![type itemAtIndex:1].enabled && [[type itemAtIndex:1].toolTip containsString:@"simctl"] && [type.titleOfSelectedItem isEqual:MVWord(@"Alert")], type.titleOfSelectedItem);
  NSGridView *fields = [pane valueForKey:@"_fields"];
  MVCheck(@"push: the fields follow the type", [fields rowAtIndex:2].hidden && ![fields rowAtIndex:0].hidden, nil);
  [type selectItemAtIndex:2];
  [type sendAction:type.action to:type.target];
  MVCheck(@"push: and a rich push takes an image", ![fields rowAtIndex:2].hidden, nil);
  MVCheck(@"push: its control and fields say what they are to a screen reader", [type.accessibilityLabel isEqual:MVWord(@"Type of push")] && [[pane valueForKey:@"_inputs"][@"title"] accessibilityLabel].length > 0, nil);
  [sent removeAllObjects];
  NSTextField *title = [pane valueForKey:@"_inputs"][@"title"];
  NSTextField *data = [pane valueForKey:@"_inputs"][@"data"];
  title.stringValue = @"Order 42";
  data.stringValue = @"order=42\nkind=shipped";
  [window.nsWindow makeFirstResponder:title];
  [window.nsWindow sendEvent:[NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:window.nsWindow.windowNumber context:nil characters:@"\r" charactersIgnoringModifiers:@"\r" isARepeat:NO keyCode:36]];
  MVPump(0.1);
  NSDictionary *args = sent.lastObject[@"args"];
  NSDictionary *wanted = @{@"app": @"dev.app", @"type": @"rich", @"title": @"Order 42", @"data": @{@"order": @"42", @"kind": @"shipped"}};
  MVCheck(@"push: Return sends what the type takes, and only what was filled", sent.count == 1 && [args isEqual:wanted], [args description]);
  NSString *refusal = @"payload replaces the fields: give one or the other";
  [pane show:@{@"op": @"answer", @"name": @"push", @"ok": @NO, @"text": refusal}];
  MVCheck(@"push: a refusal is shown whole", [pane.answer.said isEqual:MVWord(refusal)], pane.answer.said);
  [window pokeClick:@"pushMode:1"];
  MVPump(0.1);
  NSTextView *payload = [pane valueForKey:@"_payload"];
  MVCheck(@"push: the payload starts from the op's own template for the type", [payload.string containsString:@"\"mutable-content\" : 1"], payload.string);
  [sent removeAllObjects];
  [MVFindControl(window.nsWindow.contentView, @"pushGo") performClick:nil];
  MVCheck(@"push: a payload goes alone, as the op takes it", [sent.lastObject[@"args"][@"payload"] isEqual:payload.string] && !sent.lastObject[@"args"][@"title"], [sent.lastObject description]);
}
