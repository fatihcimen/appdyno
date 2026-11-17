// The app's own items of every window's menu, About, Check for Updates and Settings, and Settings' window.
#import "Window.h"

NS_ASSUME_NONNULL_BEGIN

/// Settings' window: whether Appdyno looks for releases by itself.
@interface MVSettings : NSObject
@property(class, readonly) MVSettings *shared;
@property(nonatomic, readonly, nullable) NSWindow *window;
- (void)show;
@end

/// The app's own items of every window's menu, About, Check for Updates and Settings: run from the app, its own process
/// looks for releases, and the hub's window shows what it found.
@interface MVAppItems : NSObject <NSMenuItemValidation>
@property(class, readonly) MVAppItems *shared;
/// Here is something to ask: the app's process, or the hub's `appdyno update --check`.
@property(nonatomic, readonly) BOOL canCheck;
- (void)serveHub:(MVHub *)hub;
- (void)about:(nullable id)sender;
- (void)checkForUpdates:(nullable id)sender;
- (void)settings:(nullable id)sender;
/// The project's own pages: its guide, its tools, and where to say what went wrong.
- (void)openDocs:(nullable id)sender;
- (void)openTools:(nullable id)sender;
- (void)reportIssue:(nullable id)sender;
@end

@interface MVHub (Updates)
/// What a look found, on the hub's window: an offer to install, or what it found.
- (void)showUpdate:(NSDictionary *)plain;
/// What the hub's own `appdyno update --check` said.
- (void)heardUpdate:(NSString *)said;
@end

/// Run from the app, which keeps its own process: what looks for releases and installs one.
BOOL MVInTheApp(void);
BOOL MVUpdatesByItselfOn(void);
void MVSetUpdatesByItself(BOOL on);
/// A word to the app's own process; a window kept behind for a test keeps it, for the test to read.
void MVTellApp(NSString *name, NSDictionary *_Nullable info);
NSArray<NSArray *> *MVToldApp(void);
/// What About says: the version, how this copy came and how it is updated.
NSDictionary *MVAboutOptions(void);

NS_ASSUME_NONNULL_END
