// The viewer: one window, one process, per device. JSON lines on stdin and stdout; it ends with its stdin.
// A source feeds a sink, and adding a kind of device means adding a source to MVSourceClasses.
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#import <QuartzCore/QuartzCore.h>
#import <VideoToolbox/VideoToolbox.h>

NS_ASSUME_NONNULL_BEGIN

double MVNowMs(void);
/// One JSON line on stdout, from any thread.
void MVEmit(NSDictionary *message);

/// What a second of frames came to. Thread safe; sources and the sink feed it, the app reports it.
@interface MVStats : NSObject
@property(atomic, copy) NSString *source;
@property(atomic, copy) NSString *mode;
@property(atomic, copy) NSString *decoder;
@property(atomic) CGSize size;
- (void)arrived:(size_t)bytes captureMs:(double)ms;
- (void)decodedMs:(double)ms;
- (void)shown;
- (void)dropped:(int)count;
/// The next frame to arrive answers `marked` with the time since this call.
- (void)mark;
- (void)reset;
/// This second's numbers, and starts the next.
- (NSDictionary *)report;
@end

/// Where a source gives what it has. Any thread; `from` lets a detached source's late calls be ignored.
@protocol MVSink <NSObject>
@property(readonly) MVStats *stats;
- (void)source:(id)from size:(CGSize)size codec:(NSString *)codec;
- (void)source:(id)from surface:(IOSurfaceRef)surface;
- (void)source:(id)from image:(CVImageBufferRef)image;
- (void)source:(id)from lost:(NSString *)why fatal:(BOOL)fatal;
/// A keyframe is wanted; `failures` counts decoder failures in a row, none for a loss.
- (void)source:(id)from needsKey:(int)failures;
@end

@protocol MVSource <NSObject>
- (instancetype)initWithOptions:(NSDictionary *)options sink:(id<MVSink>)sink;
- (void)start;
/// No call reaches the sink after this returns.
- (void)stop;
@optional
- (void)tick:(NSDictionary *)message;
/// The window is covered: nothing need be drawn, and what comes back asks for a fresh picture.
- (void)setHidden:(BOOL)hidden;
@end

/// The sources by the `kind` of an `attach`.
NSDictionary<NSString *, Class> *MVSourceClasses(void);

/// Calls `found` with each NAL unit of an Annex B buffer. Input is hostile: nothing is read out of bounds.
void MVForEachNal(const uint8_t *data, size_t length, void (^found)(const uint8_t *nal, size_t length));

/// Compressed frames in, decoded images to the sink. A loss or a failure freezes the picture until a keyframe.
@interface MVDecoder : NSObject
- (instancetype)initWithSink:(id<MVSink>)sink from:(id)source;
@property(atomic) BOOL hevc;
/// One access unit; returns NO when it was dropped or failed.
- (BOOL)decode:(const uint8_t *)data length:(size_t)length;
/// Nothing is decoded until a keyframe comes, and one is asked for.
- (void)awaitKey;
- (void)close;
@end

/// Reads the agent's connection: frames and clock, and hands frames to a decoder.
@interface MVSourceStream : NSObject <MVSource>
/// Runs on an open connection, with no adb in front of it.
- (void)runOnDescriptor:(int)fd;
@end

@interface MVSourceSurface : NSObject <MVSource>
@end

@interface MVSourcePixels : NSObject <MVSource>
@end

/// A point in a view, as a fraction of the picture inside it; NO outside the picture.
BOOL MVNormalize(NSPoint point, NSSize bounds, CGSize picture, double *x, double *y);
/// The USB usage (page 7) of a Mac key that types no character; 0 when it has none.
uint16_t MVUsageOfKeyCode(uint16_t keyCode);
/// Whether a key event's text is to be typed as text, rather than sent as a key.
BOOL MVIsTypedText(NSString *characters, NSEventModifierFlags flags);

/// What sits over the picture and beside it, for a person's eyes.
@interface MVOverlay : NSObject
- (instancetype)initInView:(NSView *)view;
- (void)setDriving:(BOOL)driving tool:(NSString *)tool;
- (void)showBanner:(NSDictionary *)message;
- (void)hideBanner;
- (void)addActivity:(NSString *)line;
- (void)toggleActivity;
@end

/// The window. The app keeps none when it runs headless.
@interface MVWindow : NSObject <NSWindowDelegate>
@property(readonly) MVOverlay *overlay;
- (void)configure:(NSDictionary *)attach;
- (void)setPicture:(CGSize)size;
- (void)showSurface:(IOSurfaceRef)surface;
- (void)showImage:(CVImageBufferRef)image;
- (void)setStatus:(NSDictionary *)message;
- (void)focus;
/// A click at this fraction of the picture, by the window's own event queue: needs no permission to post.
- (void)pokeX:(double)x y:(double)y;
- (void)pokeKey:(NSString *)characters;
@property(nonatomic, copy, nullable) void (^onHidden)(BOOL hidden);
@end

/// Runs the checks; the process's exit code.
int MVSelfTest(NSString *_Nullable fixtures);
/// Writes encoded test frames to stdout, for a stand-in agent: `[u32 length][u8 key][bytes]`.
int MVEncodeFixture(NSString *codec, int frames);

NS_ASSUME_NONNULL_END
