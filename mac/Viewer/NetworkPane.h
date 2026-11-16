// The Network pane's own parts, for the files it is written in: what it holds, and what one file asks of another.
#import "Place.h"
#import "Window.h"

NS_ASSUME_NONNULL_BEGIN

@interface MVNetworkPane () <NSMenuItemValidation, NSMenuDelegate> {
  NSView *_listCard;
  /// The hosts a person closed, and the request a menu was opened on.
  NSMutableSet<NSString *> *_closed;
  NSString *_menuKey;
  void (^_onSend)(NSDictionary *message);
  BOOL _watching;
  MVAnswerView *_answer;
  NSStackView *_captureRow, *_cardRows, *_requestTools;
  MVAccentButton *_go;
  NSButton *_again, *_bodies, *_curl, *_mock;
  MVInk *_dot, *_tortoise;
  NSTextField *_state, *_note, *_cardTitle, *_cardWords;
  NSPopUpButton *_way, *_throttle;
  MVSegments *_sections;
  MVFilterField *_filter;
  MVSymbolButton *_more;
  NSMenu *_menu;
  MVNetworkRules *_rules;
  MVList *_list;
  NSView *_card, *_detailCard, *_slack;
  NSTextView *_detail;
  NSTimer *_tick;
  NSArray<MVRow *> *_allRows;
  NSArray<NSString *> *_ways;
  NSString *_capturing, *_needs, *_noteSaid, *_unseen, *_proxy, *_wholeKey, *_whole, *_askedKey, *_cutSays;
  BOOL _onRules, _keeps, _real;
  /// The capture that ended was the probe's, and its requests still stand in the list.
  BOOL _wasProbe;
  NSUInteger _total, _answered;
  NSDate *_since, *_stopped;
  NSArray<NSDictionary *> *_entries;
}
@end

/// What the pane says: of the capture in its row, in the card where no request is listed, of a speed, and at its foot.
@interface MVNetworkPane (Says)
- (void)fillSpeeds;
- (void)showThrottle:(NSString *)value;
- (void)throttleChosen:(nullable id)sender;
- (void)sayState;
- (void)sayCard:(nullable NSString *)via;
- (void)foot:(NSDictionary *)m;
@end

/// What a way to capture is called here, by the op's word for it; and what the app made that no way sees, as a line.
NSString *MVNetworkWayTitle(NSString *via);
NSString *_Nullable MVNetworkUnseenLine(NSDictionary *unseen);

/// What the parent tells it, the list it makes of that, and the request chosen.
@interface MVNetworkPane (Shows)
- (void)listRows;
- (void)sifted;
- (void)showDetail:(nullable NSString *)key;
@end

/// What a person does in it.
@interface MVNetworkPane (Acts)
@property(nonatomic, readonly) BOOL probing;
- (void)setReal:(BOOL)real;
- (void)send:(NSString *)name;
- (void)go:(nullable id)sender;
- (void)bodiesChosen:(nullable id)sender;
- (void)openMenu:(nullable id)sender;
- (void)menuChosen:(NSMenuItem *)item;
- (void)pressed:(NSButton *)sender;
- (void)sectionChosen:(NSInteger)at;
- (void)readAgain:(nullable id)sender;
- (void)wayChosen:(nullable id)sender;
/// A host's heading opened or closed; the request chosen left; and what is done to one request, by its name.
- (void)toggle:(NSString *)host;
- (void)leave;
- (void)act:(NSString *)name on:(nullable NSString *)key;
- (NSArray<NSAccessibilityCustomAction *> *)actionsOn:(NSString *)key;
@end

/// What the pane says and offers, from what it was last told; and the time gone, kept only while it is looked at.
@interface MVNetworkPane (Lays)
- (void)layOut;
- (void)keepTime;
@end

NS_ASSUME_NONNULL_END
