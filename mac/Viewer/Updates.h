// What the hub's window and the app's own process say to each other of updates, each a process of its own: the app's
// looks for a release and is what installs one; the window is where a person sees it.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The window asks for a look now.
static NSString *const MVUpdateCheck = @"dev.appdyno.app.checkForUpdates";
/// A person said yes to the release offered, `version`.
static NSString *const MVUpdateInstall = @"dev.appdyno.app.installUpdate";
/// And no: `version` is not offered again by itself.
static NSString *const MVUpdateLater = @"dev.appdyno.app.declineUpdate";
/// What a look found, for the window to show: `title`, `text`, and `offer`, the version, where there is one.
static NSString *const MVUpdateAnswer = @"dev.appdyno.app.updateAnswer";
/// The hub's window has opened: a release found before it heard nothing of it.
static NSString *const MVUpdateWindowUp = @"dev.appdyno.app.windowUp";
/// The app's own preferences, where a person's choice is kept: on unless turned off.
static NSString *const MVAppDomain = @"dev.appdyno.app";
static NSString *const MVUpdatesByItself = @"checkForUpdatesAutomatically";

/// What `appdyno update --check` said, as a person is told it: `title`, `text`, and `offer`, the version, where one is;
/// `latest`, where a newer one is out and this copy cannot have it as it stands.
NSDictionary<NSString *, NSString *> *MVUpdateWords(NSString *said);

NS_ASSUME_NONNULL_END
