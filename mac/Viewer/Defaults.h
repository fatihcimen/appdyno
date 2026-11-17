// Where the app and its windows keep what a person chose, and where a test's run keeps it instead.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// This process's own: a window's, or the app's in its own process. A test's run's domain where APPDYNO_DEFAULTS names one.
NSUserDefaults *MVDefaults(void);
/// The app's own, from a window: where Settings keeps the switch the app's process reads.
NSUserDefaults *MVAppDefaults(void);
/// A test's run: nothing the system keeps by the app's id is written either, such as a window's frame.
BOOL MVDefaultsAreATest(void);

NS_ASSUME_NONNULL_END
