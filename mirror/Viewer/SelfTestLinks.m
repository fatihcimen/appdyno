// The Links pane in a window kept behind: how a person reaches it, what Return sends, and what an answer shows.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"
#import <Carbon/Carbon.h>

/// Return, as the keyboard sends it, to whatever has the window's keyboard.
static void pressReturn(NSWindow *window) {
  [window sendEvent:[NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil characters:@"\r" charactersIgnoringModifiers:@"\r" isARepeat:NO keyCode:kVK_Return]];
  MVPump(0.1);
}

static BOOL typesInto(NSWindow *window, NSTextField *field) {
  id editing = window.firstResponder;
  return [editing isKindOfClass:NSTextView.class] && [(NSTextView *)editing delegate] == (id)field;
}

static void checkAnswers(MVLinkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  MVAnswerView *answer = pane.answer;
  [pane show:@{@"op": @"answer", @"name": @"openLink", @"line": @"Connecting to a device"}];
  MVCheck(@"links: progress shows as it comes", [pane.answer.said containsString:@"Connecting"], pane.answer.said);
  MVHoldStill(YES);
  [pane show:@{@"op": @"answer", @"name": @"openLink", @"ok": @YES, @"text": @"Opened app://screen/form", @"recent": @[@"app://screen/form", @"https://example.test/item/7"]}];
  MVCheck(@"links: what the op did is said, with no move for a person who asked for less", [pane.answer.said isEqual:@"Opened app://screen/form"] && ![answer.layer animationForKey:@"slide"], pane.answer.said);
  MVHoldStill(NO);
  MVCheck(@"links: the recent links stand under a heading", pane.rows.count == 3 && pane.rows[0].header && [pane.rows[2].key isEqual:@"https://example.test/item/7"], [[pane.rows valueForKey:@"title"] componentsJoinedByString:@"|"]);
  NSString *refusal = @"this link is not on this server's allow list", *hint = @"change that and call again: nothing was done";
  [pane fill:@"https://elsewhere.test/"];
  pressReturn(pane.window);
  [pane show:@{@"op": @"answer", @"name": @"openLink", @"ok": @NO, @"text": refusal, @"hint": hint}];
  MVCheck(@"links: a refusal is shown whole, with what to do", [pane.answer.said isEqual:MVWord(refusal)] && [pane.answer.hint isEqual:MVWord(hint)], [NSString stringWithFormat:@"%@ / %@", pane.answer.said, pane.answer.hint]);
  MVCheck(@"links: an answer arrives with a move, where motion is on", [answer.layer animationForKey:@"slide"] != nil, nil);
  [pane.window layoutIfNeeded];
  NSView *mark = [answer valueForKey:@"_mark"];
  NSRect at = [mark convertRect:mark.bounds toView:pane];
  MVCheck(@"links: an answer reads from the pane's edge, its mark beside its words", NSMinX(at) < 2 && NSWidth(at) < 20, NSStringFromRect(at));
  [sent removeAllObjects];
  MVPokeListRow([pane valueForKey:@"_recent"], @"https://example.test/item/7");
  MVPump(0.2);
  pressReturn(pane.window);
  MVCheck(@"links: a recent link chosen opens again with Return", [sent.lastObject[@"url"] isEqual:@"https://example.test/item/7"], [sent.lastObject description]);
}

void MVCheckLinks(void) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": @"links", @"look": @{@"controls": @[@"home"]}}];
  [window.nsWindow setContentSize:NSMakeSize(1200, 800)];
  MVLinkPane *pane = window.inspector.links;
  NSMutableArray<NSDictionary *> *sent = [NSMutableArray array];
  pane.onSend = ^(NSDictionary *message) {
    [sent addObject:message];
  };
  [window pokeMenu:@"openLink"];
  MVPump(0.3);
  NSTextField *field = [pane valueForKey:@"_field"];
  MVCheck(@"links: Open Link in More shows the pane, its field taking the keyboard", window.inspecting && window.inspector.chosen == MVPaneLinks && typesInto(window.nsWindow, field), NSStringFromClass([window.nsWindow.firstResponder class]));
  MVCheck(@"links: the pane asks once for this device's recent links", sent.count == 1 && [sent[0][@"name"] isEqual:@"links"], sent.description);
  MVCheck(@"links: its field and button say what they are to a screen reader", [field.accessibilityLabel isEqual:MVWord(@"Link to open")] && [MVFindControl(window.nsWindow.contentView, @"openLinkGo").accessibilityLabel isEqual:MVControlTitle(@"openLink")], nil);
  [sent removeAllObjects];
  [pane fill:@"  appdyno-fixture://open/form "];
  pressReturn(window.nsWindow);
  pressReturn(window.nsWindow);
  MVCheck(@"links: Return sends the link, once, until its answer comes", sent.count == 1 && [sent[0][@"name"] isEqual:@"openLink"] && [sent[0][@"url"] isEqual:@"appdyno-fixture://open/form"], sent.description);
  MVCheck(@"links: and says it is opening", [pane.answer.said containsString:@"appdyno-fixture://open/form"], pane.answer.said);
  checkAnswers(pane, sent);
}
