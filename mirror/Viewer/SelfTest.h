#import "Viewer.h"

NS_ASSUME_NONNULL_BEGIN

@interface MVTestFrame : NSObject
@property(nonatomic) NSData *data;
@property(nonatomic) BOOL key;
@end

/// `count` frames in Annex B, a keyframe every `keyEvery`; nil where this Mac has no such encoder.
NSArray<MVTestFrame *> *_Nullable MVEncodeFrames(BOOL hevc, int count, int keyEvery);

/// Runs the checks; the process's exit code.
int MVSelfTest(NSString *_Nullable fixtures);
/// Writes encoded test frames to stdout, for a stand-in agent: `[u32 length][u8 key][bytes]`.
int MVEncodeFixture(NSString *codec, int frames);

void MVCheck(NSString *name, BOOL ok, NSString *_Nullable detail);
void MVTestMotion(void);
void MVSkip(NSString *name, NSString *why);

/// A sink that counts, and lets a check wait until a count is reached.
@interface MVTestSink : NSObject <MVSink>
@property(atomic) int images, surfaces, sizes;
@property(atomic, copy, nullable) NSString *lost;
@property(atomic) CGSize lastSize;
@property(atomic, copy, nullable) NSString *lastCodec;
@property(atomic) OSType lastFormat;
@property(atomic, nullable) id lastImage;
@property(atomic, nullable) id lastSurface;
@property(atomic) int keyRequests, lastFailures;
/// The capture time each picture came out with.
@property(atomic, readonly) NSCountedSet<NSNumber *> *captured;
- (BOOL)waitForKeyRequests:(int)count;
- (BOOL)waitForImages:(int)count;
- (BOOL)waitForLost;
@end

void MVCheckPixels(void);
void MVCheckPipe(void);
void MVCheckRecorder(void);
void MVCheckKeyboard(void);
void MVCheckFrame(void);
void MVCheckFlow(void);
void MVCheckShell(void);
void MVCheckPlaces(void);
void MVCheckConnect(void);
void MVCheckLinks(void);
void MVCheckPush(void);
void MVCheckHevc444(NSString *_Nullable fixtures);
/// Lets what was sent reach a window kept behind.
void MVPump(double seconds);
/// Return, as the keyboard sends it, to whatever has the window's keyboard.
void MVPressReturn(NSWindow *window);
@class MVHub, MVList;
/// A row of a list by a real click, or, where a table takes none from this test, chosen as that click would.
void MVPokeListRow(MVList *list, NSString *title);
/// The same on the hub's sidebar.
void MVPokeRow(MVHub *hub, NSString *title);
/// A check of what a real click on a table's row did: said by name, with why, where a table takes no click from this test.
void MVCheckRowClick(NSString *name, BOOL ok, NSString *_Nullable detail);

NS_ASSUME_NONNULL_END
