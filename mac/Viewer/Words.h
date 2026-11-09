#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// One row of the table of words.
typedef struct {
  const char *en, *tr;
} MVWordRow;

/// One table, in a file for each of the larger parts.
extern const MVWordRow MVWordTable[], MVWordTableClients[], MVWordTableHelp[], MVWordTableConnect[], MVWordTableDevice[], MVWordTablePanes[];
extern const size_t MVWordCount, MVWordCountClients, MVWordCountHelp, MVWordCountConnect, MVWordCountDevice, MVWordCountPanes;

/// Words in the Mac's language: English comes back as it went in, and so does anything the table does not have, such as a name.
NSString *MVWord(NSString *english);
/// The same whatever the Mac's language.
NSString *MVInTurkish(NSString *english);
/// A sentence the parent or a device sent whole, in the Mac's language, with what changes in it kept as it came: an app's
/// name, an element's label, an address. A part with the shape of a sentence of the table, such as a count, is said too.
NSString *MVSentence(NSString *english);
/// A row, by its English, with what changes put in as it is: a name there may hold anything, a comma too, and is never
/// itself said in another language.
NSString *MVFormat(NSString *english, NSArray<NSString *> *values);
/// For a test: speaks Turkish whatever the Mac's language, or goes back to it.
void MVTestTurkish(BOOL on);
/// A number with the Mac's decimal mark, and `%` on the side its language puts it.
NSString *MVPercent(double value);
/// The same for a number with one decimal.
NSString *MVDecimal(double value);

NS_ASSUME_NONNULL_END
