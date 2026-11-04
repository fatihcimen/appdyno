#import "Viewer.h"

NS_ASSUME_NONNULL_BEGIN

/// The picture's view: what a person's mouse, trackpad and keys land on.
@interface MVView : NSView
@property(nonatomic) CGSize picture;
@property(nonatomic) BOOL inputOn;
/// NO until a person's click, where a window starts so: that click goes no further.
@property(nonatomic) BOOL armed;
@property(readonly) BOOL takesPointer;
/// Only in the key window, whatever reaches it: what is typed elsewhere is not a device's to have.
@property(readonly) BOOL takesKeys;
@end

typedef NS_ENUM(NSInteger, MVShow) { MVShowBehind, MVShowFront, MVShowFocused };

/// How a window shows itself. Only a person's `--focus` gives it the keyboard; a click does the rest.
MVShow MVShowOf(BOOL focus, BOOL behind);

NS_ASSUME_NONNULL_END
