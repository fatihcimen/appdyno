// The Push pane in a window kept behind: what the op says a device takes, the fields that follow the type, the payload
// to start from, what a send carries, an answer shown whole, and a token a person types where a route takes one.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

static NSString *const kToken = @"c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffee";

static NSDictionary *typesSaid(void) {
  return @{@"op": @"answer",
           @"name": @"push",
           @"app": @"dev.app",
           @"types": @[
             @{@"type": @"alert",
               @"route": @"simctl push",
               @"fields": @[@"title", @"body", @"data"],
               @"template": @"{\"aps\":{\"alert\":{\"title\":\"T\"}}}"},
             @{@"type": @"background", @"why": @"simctl takes no push with nothing to see"},
             @{@"type": @"rich",
               @"route": @"simctl push with mutable-content",
               @"fields": @[@"title", @"body", @"image", @"data"],
               @"template": @"{\"aps\":{\"mutable-content\":1},\"image\":\"I\"}"},
           ]};
}

/// The same once APNs is set up: a route by it names the tokens it goes by.
static NSDictionary *tokensSaid(void) {
  return @{@"op": @"answer",
           @"name": @"push",
           @"types": @[
             @{@"type": @"alert",
               @"route": @"simctl push",
               @"fields": @[@"title"],
               @"template": @"{}"},
             @{@"type": @"rich",
               @"route": @"APNs' sandbox",
               @"fields": @[@"title"],
               @"template": @"{}",
               @"tokens": @[@"device"]},
             @{@"type": @"live_activity",
               @"route": @"APNs' sandbox",
               @"fields": @[],
               @"template": @"{}",
               @"tokens": @[@"activity", @"start"]},
           ]};
}

static void checkToken(MVWindow *window, MVPushPane *pane, NSMutableArray<NSDictionary *> *sent) {
  MVHoldStill(YES);
  [pane show:@{@"op": @"answer",
               @"name": @"push",
               @"ok": @YES,
               @"text": @"Pushed to dev.app"}];
  NSView *card = [pane valueForKey:@"_tokenCard"];
  MVCheck(@"push: no token field where no route takes one a person types", card.isHiddenOrHasHiddenAncestor, nil);
  [pane show:tokensSaid()];
  NSPopUpButton *type = [pane valueForKey:@"_type"], *kind = [pane valueForKey:@"_kind"];
  NSTextField *token = [pane valueForKey:@"_token"], *note = [pane valueForKey:@"_tokenNote"];
  MVCheck(@"push: a field unseen as it is typed where a route takes a token, with each kind the routes go by", !card.hidden && [token isKindOfClass:NSSecureTextField.class] && kind.numberOfItems == 3 && [[kind itemAtIndex:2].title isEqual:MVWord(@"Push to Start")], [kind.itemTitles componentsJoinedByString:@"|"]);
  [type selectItemAtIndex:2];
  [type sendAction:type.action to:type.target];
  MVCheck(@"push: the kind follows the type, and the pane says whose the token is and for how long", [kind.titleOfSelectedItem isEqual:MVWord(@"Activity")] && [note.stringValue isEqual:MVWord(@"Kept for this session only, as dev.app's Activity token")], note.stringValue);
  MVCheck(@"push: the token's field, kind and button say what they are to a screen reader", [token.accessibilityLabel isEqual:MVWord(@"Push token")] && [kind.accessibilityLabel isEqual:MVWord(@"Kind of token")] && [MVFindControl(window.nsWindow.contentView, @"pushTokenGo").accessibilityLabel isEqual:MVWord(@"Keep push token")], nil);
  [kind selectItemAtIndex:2];
  [kind sendAction:kind.action to:kind.target];
  [sent removeAllObjects];
  token.stringValue = kToken;
  [window.nsWindow makeFirstResponder:token];
  MVPressReturn(window.nsWindow);
  MVPressReturn(window.nsWindow);
  NSDictionary *wanted = @{@"op": @"control", @"name": @"pushToken", @"app": @"dev.app", @"token": kToken, @"kind": @"start"};
  MVCheck(@"push: Return keeps the token for the app and kind in the pane, once, and the field lets it go", sent.count == 1 && [sent[0] isEqual:wanted] && !token.stringValue.length, sent.description);
  [pane show:@{@"op": @"answer",
               @"name": @"push",
               @"ok": @YES,
               @"text": @"Kept dev.app's start token for this session only"}];
  MVCheck(@"push: what became of the token is said, with no move for a person who asked for less, and none of the token", [pane.answer.said containsString:@"session only"] && ![pane.answer.layer animationForKey:@"slide"] && ![note.stringValue containsString:kToken], pane.answer.said);
  MVHoldStill(NO);
  // a secure field with the keyboard keeps the Mac's other apps from what is typed: it lets go
  [window.nsWindow makeFirstResponder:nil];
  [pane show:typesSaid()];
  MVCheck(@"push: the field goes with the routes that took a token", card.isHiddenOrHasHiddenAncestor, nil);
}

/// In the hub a device's Inspector stands in the room's slot, apart from the device's views: what it and its panes send
/// still names that device, as the hub sends to a device only by its stage.
static void checkInHub(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  MVWindow *window = [[MVWindow alloc] initInRoom:hub.room];
  [window configure:@{@"title": @"push",
                      @"stage": @"emulator-5554",
                      @"look": @{@"controls": @[@"home"]}}];
  [window pokeMenu:@"push"];
  MVPump(0.3);
  MVInspector *inspector = window.inspector;
  BOOL apart = YES;
  for (NSView *above = inspector.push; above; above = above.superview)
    if ([above isKindOfClass:MVRootView.class]) apart = NO;
  MVCheck(@"push: in the hub its pane stands apart from the device's views", apart, nil);
  MVCheck(@"push: and what Push, Links and Apps send names the device", [MVStageOf(inspector.push) isEqual:@"emulator-5554"] && [MVStageOf(inspector.links) isEqual:@"emulator-5554"] && [MVStageOf(inspector) isEqual:@"emulator-5554"], MVStageOf(inspector.push));
  [window leave];
}

void MVCheckPush(void) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": @"push",
                      @"look": @{@"controls": @[@"home"]}}];
  [window.nsWindow setContentSize:NSMakeSize(1200, 800)];
  MVPushPane *pane = window.inspector.push;
  NSMutableArray<NSDictionary *> *sent = [NSMutableArray array];
  pane.onSend = ^(NSDictionary *message) {
    [sent addObject:message];
  };
  [window pokeMenu:@"push"];
  MVPump(0.3);
  MVCheck(@"push: Send Push in More shows the pane, and asks what this device takes", window.inspecting && window.inspector.chosen == MVPanePush && [sent.lastObject[@"name"] isEqual:@"pushes"], sent.description);
  MVCheck(@"push: in a window of its own, of one device, what it sends names none", MVStageOf(pane) == nil, MVStageOf(pane));
  [pane show:typesSaid()];
  NSPopUpButton *type = [pane valueForKey:@"_type"];
  NSTextField *app = [pane valueForKey:@"_app"];
  MVCheck(@"push: the window's app stands in its field", [app.stringValue isEqual:@"dev.app"], app.stringValue);
  [window.nsWindow makeFirstResponder:app];
  [app.currentEditor selectAll:nil];
  [app.currentEditor insertText:@"dev.other"];
  [sent removeAllObjects];
  [window.nsWindow makeFirstResponder:nil];
  MVCheck(@"push: another app named, the pane asks what that app's build takes", [sent.lastObject isEqual:(@{@"op": @"control", @"name": @"pushes", @"app": @"dev.other"})], sent.description);
  app.stringValue = @"dev.app";
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
  MVPressReturn(window.nsWindow);
  NSDictionary *args = sent.lastObject[@"args"];
  NSDictionary *wanted = @{@"app": @"dev.app",
                           @"type": @"rich",
                           @"title": @"Order 42",
                           @"data": @{@"order": @"42", @"kind": @"shipped"}};
  MVCheck(@"push: Return sends what the type takes, and only what was filled", sent.count == 1 && [args isEqual:wanted], [args description]);
  NSString *refusal = @"payload replaces the fields: give one or the other";
  [pane show:@{@"op": @"answer",
               @"name": @"push",
               @"ok": @NO,
               @"text": refusal}];
  MVCheck(@"push: a refusal is shown whole", [pane.answer.said isEqual:MVWord(refusal)], pane.answer.said);
  [window pokeClick:@"pushMode:1"];
  MVPump(0.1);
  NSTextView *payload = [pane valueForKey:@"_payload"];
  MVCheck(@"push: the payload starts from the op's own template for the type", [payload.string containsString:@"\"mutable-content\" : 1"], payload.string);
  [sent removeAllObjects];
  [MVFindControl(window.nsWindow.contentView, @"pushGo") performClick:nil];
  MVCheck(@"push: a payload goes alone, as the op takes it", [sent.lastObject[@"args"][@"payload"] isEqual:payload.string] && !sent.lastObject[@"args"][@"title"], [sent.lastObject description]);
  checkToken(window, pane, sent);
  checkInHub();
}
