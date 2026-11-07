// Well-known merchants: how to recognize them in a bank description, the
// clean name to show, and the category they almost always belong to.
// `auto: false` means the category is only a suggestion (the merchant sells
// many kinds of things, so a person confirms).
//
// Order matters: the first match wins, so put specific patterns before
// general ones (e.g. "Uber Eats" before "Uber").

export interface KnownMerchant {
  name: string;
  match: RegExp;
  /** "Category/Subcategory" from DEFAULT_CATEGORIES, or null for no default */
  path: string | null;
  auto: boolean;
}

const m = (name: string, match: RegExp, path: string | null, auto = true): KnownMerchant => ({ name, match, path, auto });

const RESTAURANTS = "Food/Restaurants";
const COFFEE = "Food/Coffee";
const GROCERIES = "Food/Groceries";
const DELIVERY = "Food/Delivery";
const GAS = "Transportation/Gas";
const SHOPPING = "Personal/Shopping";
const STREAMING = "Subscriptions/Streaming";

export const MERCHANT_LIBRARY: KnownMerchant[] = [
  // --- Subscriptions (before the stores that share a name) ---------------------
  m("Amazon Prime", /AMAZON PRIME|PRIME VIDEO|AMZN PRIME/, "Subscriptions/Other Subscriptions"),
  m("Netflix", /NETFLIX/, STREAMING),
  m("Hulu", /HULU/, STREAMING),
  m("Disney+", /DISNEY ?PLUS|DISNEY\+/, STREAMING),
  m("Max", /\bHBO ?MAX\b|\bMAX\.COM\b/, STREAMING),
  m("Peacock", /PEACOCK/, STREAMING),
  m("Paramount+", /PARAMOUNT\+|PARAMOUNT PLUS/, STREAMING),
  m("YouTube Premium", /YOUTUBE ?PREMIUM|YOUTUBE ?TV|GOOGLE \*YOUTUBE/, STREAMING),
  m("Spotify", /SPOTIFY/, STREAMING),
  m("Apple Music", /APPLE ?MUSIC/, STREAMING),
  m("Audible", /AUDIBLE/, "Subscriptions/Other Subscriptions"),
  m("SiriusXM", /SIRIUS ?XM/, STREAMING),
  m("ChatGPT", /OPENAI|CHATGPT/, "Subscriptions/AI / Software"),
  m("Claude", /ANTHROPIC|CLAUDE\.AI/, "Subscriptions/AI / Software"),
  m("Microsoft 365", /MICROSOFT ?365|MSFT ?\*|MICROSOFT\*/, "Subscriptions/AI / Software"),
  m("Adobe", /ADOBE/, "Subscriptions/AI / Software"),
  m("Google One", /GOOGLE ?\*?ONE\b|GOOGLE STORAGE/, "Subscriptions/Cloud Storage"),
  m("Google Cloud", /GOOGLE ?\*?CLOUD/, "Subscriptions/Cloud Storage"),
  m("Dropbox", /DROPBOX/, "Subscriptions/Cloud Storage"),
  m("Apple", /APPLE\.COM\/BILL|APPLE COM BILL|ITUNES/, "Subscriptions/Other Subscriptions", false),
  m("Ring", /\bRING\b.*(PLAN|PROTECT|BASIC)|RING\.COM/, "Subscriptions/Home Security"),
  m("SimpliSafe", /SIMPLISAFE/, "Subscriptions/Home Security"),
  m("ADT", /\bADT\b/, "Subscriptions/Home Security"),
  m("Snapchat", /SNAPCHAT|SNAP INC/, "Subscriptions/Other Subscriptions"),

  // --- Delivery (before restaurants and rideshare) ---------------------------
  m("Uber Eats", /UBER\s*\*?\s*EATS/, DELIVERY),
  m("DoorDash", /DOORDASH|\bDD \*/, DELIVERY),
  m("Grubhub", /GRUBHUB/, DELIVERY),
  m("Instacart", /INSTACART/, GROCERIES),

  // --- Coffee ----------------------------------------------------------------
  m("Starbucks", /STARBUCKS/, COFFEE),
  m("Dunkin'", /DUNKIN/, COFFEE),
  m("Dutch Bros", /DUTCH BROS/, COFFEE),
  m("Peet's Coffee", /PEET'?S/, COFFEE),
  m("Tim Hortons", /TIM HORTONS/, COFFEE),
  m("Blue Bottle Coffee", /BLUE BOTTLE/, COFFEE),
  m("Compass Coffee", /COMPASS COFFEE/, COFFEE),

  // --- Restaurants & fast food -------------------------------------------------
  m("McDonald's", /MCDONALD/, RESTAURANTS),
  m("Burger King", /BURGER KING/, RESTAURANTS),
  m("Wendy's", /WENDY'?S/, RESTAURANTS),
  m("Chick-fil-A", /CHICK-?FIL-?A/, RESTAURANTS),
  m("Taco Bell", /TACO BELL/, RESTAURANTS),
  m("Chipotle", /CHIPOTLE/, RESTAURANTS),
  m("Qdoba", /QDOBA/, RESTAURANTS),
  m("Subway", /\bSUBWAY\b/, RESTAURANTS),
  m("Jersey Mike's", /JERSEY MIKE/, RESTAURANTS),
  m("Jimmy John's", /JIMMY JOHN/, RESTAURANTS),
  m("Firehouse Subs", /FIREHOUSE SUBS/, RESTAURANTS),
  m("Panera Bread", /PANERA/, RESTAURANTS),
  m("Five Guys", /FIVE GUYS/, RESTAURANTS),
  m("Shake Shack", /SHAKE SHACK/, RESTAURANTS),
  m("In-N-Out", /IN-N-OUT|IN N OUT/, RESTAURANTS),
  m("Popeyes", /POPEYES/, RESTAURANTS),
  m("KFC", /\bKFC\b/, RESTAURANTS),
  m("Raising Cane's", /RAISING CANE/, RESTAURANTS),
  m("Wingstop", /WINGSTOP/, RESTAURANTS),
  m("Buffalo Wild Wings", /BUFFALO WILD|\bBWW\b/, RESTAURANTS),
  m("Panda Express", /PANDA EXPRESS/, RESTAURANTS),
  m("Sweetgreen", /SWEETGREEN/, RESTAURANTS),
  m("Cava", /\bCAVA\b/, RESTAURANTS),
  m("Domino's", /DOMINO'?S/, RESTAURANTS),
  m("Pizza Hut", /PIZZA HUT/, RESTAURANTS),
  m("Papa John's", /PAPA JOHN/, RESTAURANTS),
  m("&pizza", /&PIZZA|AND PIZZA/, RESTAURANTS),
  m("Sonic", /SONIC DRIVE/, RESTAURANTS),
  m("Arby's", /ARBY'?S/, RESTAURANTS),
  m("Jack in the Box", /JACK IN THE BOX/, RESTAURANTS),
  m("Culver's", /CULVER'?S/, RESTAURANTS),
  m("Whataburger", /WHATABURGER/, RESTAURANTS),
  m("Zaxby's", /ZAXBY/, RESTAURANTS),
  m("Bojangles", /BOJANGLES/, RESTAURANTS),
  m("Noodles & Company", /NOODLES & CO|NOODLES AND CO/, RESTAURANTS),
  m("Olive Garden", /OLIVE GARDEN/, RESTAURANTS),
  m("Chili's", /CHILI'?S/, RESTAURANTS),
  m("Applebee's", /APPLEBEE/, RESTAURANTS),
  m("Texas Roadhouse", /TEXAS ROADHOUSE/, RESTAURANTS),
  m("Outback Steakhouse", /OUTBACK/, RESTAURANTS),
  m("Red Robin", /RED ROBIN/, RESTAURANTS),
  m("IHOP", /\bIHOP\b/, RESTAURANTS),
  m("Denny's", /DENNY'?S/, RESTAURANTS),
  m("Cracker Barrel", /CRACKER BARREL/, RESTAURANTS),
  m("The Cheesecake Factory", /CHEESECAKE FACTORY/, RESTAURANTS),
  m("P.F. Chang's", /P\.?F\.? CHANG/, RESTAURANTS),
  m("Nando's", /NANDO'?S/, RESTAURANTS),
  m("Krispy Kreme", /KRISPY KREME/, "Food/Snacks"),
  m("Crumbl", /CRUMBL/, "Food/Snacks"),
  m("Baskin-Robbins", /BASKIN/, "Food/Snacks"),
  m("Rita's", /RITA'?S ITALIAN ICE/, "Food/Snacks"),

  // --- Groceries ---------------------------------------------------------------
  m("Trader Joe's", /TRADER JOE/, GROCERIES),
  m("Whole Foods", /WHOLEFDS|WHOLE FOODS/, GROCERIES),
  m("Safeway", /SAFEWAY/, GROCERIES),
  m("Giant", /GIANT FOOD|^GIANT\b/, GROCERIES),
  m("Harris Teeter", /HARRIS TEETER/, GROCERIES),
  m("Wegmans", /WEGMANS/, GROCERIES),
  m("Kroger", /KROGER/, GROCERIES),
  m("Publix", /PUBLIX/, GROCERIES),
  m("Aldi", /\bALDI\b/, GROCERIES),
  m("Lidl", /\bLIDL\b/, GROCERIES),
  m("Food Lion", /FOOD LION/, GROCERIES),
  m("Sprouts", /SPROUTS/, GROCERIES),
  m("H Mart", /\bH ?MART\b/, GROCERIES),
  m("Lotte Plaza", /LOTTE/, GROCERIES),
  m("Patel Brothers", /PATEL BROTHERS/, GROCERIES),
  m("Weis Markets", /WEIS MARKETS/, GROCERIES),
  m("ShopRite", /SHOPRITE/, GROCERIES),
  m("Stop & Shop", /STOP & SHOP/, GROCERIES),
  m("H-E-B", /\bH-E-B\b|\bHEB\b/, GROCERIES),
  m("Costco", /COSTCO/, GROCERIES, false),
  m("Sam's Club", /SAM'?S CLUB|SAMSCLUB/, GROCERIES, false),
  m("BJ's Wholesale", /BJ'?S WHOLESALE/, GROCERIES, false),

  // --- Gas stations --------------------------------------------------------------
  m("Shell", /\bSHELL\b/, GAS),
  m("Exxon", /EXXON/, GAS),
  m("Mobil", /\bMOBIL\b/, GAS),
  m("BP", /\bBP#|\bBP\b/, GAS),
  m("Sunoco", /SUNOCO/, GAS),
  m("Chevron", /CHEVRON/, GAS),
  m("Texaco", /TEXACO/, GAS),
  m("Citgo", /CITGO/, GAS),
  m("Valero", /VALERO/, GAS),
  m("Marathon", /MARATHON PETRO/, GAS),
  m("Speedway", /SPEEDWAY/, GAS),
  m("Sheetz", /SHEETZ/, GAS, false),
  m("Wawa", /\bWAWA\b/, GAS, false),
  m("Royal Farms", /ROYAL FARMS/, GAS, false),
  m("7-Eleven", /7-ELEVEN|7 ELEVEN/, GAS, false),
  m("QuikTrip", /QUIKTRIP|\bQT \d/, GAS, false),
  m("Circle K", /CIRCLE K/, GAS, false),

  // --- Transportation ---------------------------------------------------------
  m("Uber", /\bUBER\b/, "Transportation/Other Transportation", false),
  m("Lyft", /\bLYFT\b/, "Transportation/Other Transportation", false),
  m("WMATA", /WMATA|SMARTRIP/, "Transportation/Metro"),
  m("E-ZPass", /E-?Z ?PASS/, "Transportation/Tolls"),
  m("ParkMobile", /PARKMOBILE/, "Transportation/Parking"),
  m("SpotHero", /SPOTHERO/, "Transportation/Parking"),
  m("Geico", /GEICO/, "Transportation/Car Insurance"),
  m("Progressive", /PROGRESSIVE/, "Transportation/Car Insurance"),
  m("State Farm", /STATE FARM/, "Transportation/Car Insurance"),
  m("Allstate", /ALLSTATE/, "Transportation/Car Insurance"),
  m("USAA", /\bUSAA\b/, "Transportation/Car Insurance", false),
  m("Jiffy Lube", /JIFFY LUBE/, "Transportation/Car Maintenance"),
  m("Valvoline", /VALVOLINE/, "Transportation/Car Maintenance"),
  m("Midas", /\bMIDAS\b/, "Transportation/Car Maintenance"),
  m("Discount Tire", /DISCOUNT TIRE/, "Transportation/Car Maintenance"),
  m("AutoZone", /AUTOZONE/, "Transportation/Car Maintenance"),
  m("Advance Auto Parts", /ADVANCE AUTO/, "Transportation/Car Maintenance"),

  // --- Shopping --------------------------------------------------------------------
  m("Amazon", /AMZN|AMAZON/, SHOPPING, false),
  m("Target", /\bTARGET\b/, SHOPPING, false),
  m("Walmart", /WAL-?MART|WM SUPERCENTER/, SHOPPING, false),
  m("Best Buy", /BEST ?BUY/, SHOPPING),
  m("Apple Store", /APPLE STORE|APPLE\.COM\/US/, SHOPPING),
  m("TJ Maxx", /T\.?J\.? ?MAXX/, SHOPPING),
  m("Marshalls", /MARSHALLS/, SHOPPING),
  m("HomeGoods", /HOMEGOODS/, SHOPPING),
  m("Ross", /ROSS STORES/, SHOPPING),
  m("Kohl's", /KOHL'?S/, SHOPPING),
  m("Macy's", /MACY'?S/, SHOPPING),
  m("Nordstrom", /NORDSTROM/, SHOPPING),
  m("Old Navy", /OLD NAVY/, SHOPPING),
  m("Gap", /\bGAP\b/, SHOPPING),
  m("H&M", /\bH ?& ?M\b/, SHOPPING),
  m("Zara", /\bZARA\b/, SHOPPING),
  m("Uniqlo", /UNIQLO/, SHOPPING),
  m("Nike", /\bNIKE\b/, SHOPPING),
  m("Sephora", /SEPHORA/, "Health & Wellness/Personal Care"),
  m("Ulta", /\bULTA\b/, "Health & Wellness/Personal Care"),
  m("Bath & Body Works", /BATH & BODY|BATH AND BODY/, "Health & Wellness/Personal Care"),
  m("Etsy", /ETSY/, SHOPPING, false),
  m("eBay", /\bEBAY\b/, SHOPPING, false),
  m("Shein", /SHEIN/, SHOPPING),
  m("Temu", /\bTEMU\b/, SHOPPING),
  m("Dollar Tree", /DOLLAR TREE/, SHOPPING, false),
  m("Dollar General", /DOLLAR GENERAL/, SHOPPING, false),
  m("IKEA", /\bIKEA\b/, "Housing/Other Housing", false),
  m("Home Depot", /HOME DEPOT/, "Housing/Other Housing", false),
  m("Lowe's", /LOWE'?S/, "Housing/Other Housing", false),
  m("Wayfair", /WAYFAIR/, "Housing/Other Housing", false),
  m("Bed Bath & Beyond", /BED BATH/, "Housing/Other Housing", false),

  // --- Health ----------------------------------------------------------------------
  m("CVS Pharmacy", /CVS/, "Health & Wellness/Medical", false),
  m("Walgreens", /WALGREENS/, "Health & Wellness/Medical", false),
  m("Rite Aid", /RITE AID/, "Health & Wellness/Medical", false),
  m("Planet Fitness", /PLANET FIT/, "Health & Wellness/Gym"),
  m("Orangetheory", /ORANGETHEORY/, "Health & Wellness/Gym"),
  m("LA Fitness", /LA FITNESS/, "Health & Wellness/Gym"),
  m("Gold's Gym", /GOLD'?S GYM/, "Health & Wellness/Gym"),
  m("Equinox", /EQUINOX/, "Health & Wellness/Gym"),
  m("ClassPass", /CLASSPASS/, "Health & Wellness/Gym"),
  m("Peloton", /PELOTON/, "Health & Wellness/Gym"),
  m("Great Clips", /GREAT CLIPS/, "Health & Wellness/Personal Care"),
  m("Supercuts", /SUPERCUTS/, "Health & Wellness/Personal Care"),

  // --- Dog -----------------------------------------------------------------------------
  m("Chewy", /CHEWY/, "Dog/Supplies"),
  m("PetSmart", /PETSMART/, "Dog/Supplies", false),
  m("Petco", /PETCO/, "Dog/Supplies", false),
  m("BarkBox", /BARKBOX|BARK BOX/, "Dog/Supplies"),
  m("Rover", /ROVER\.COM|^ROVER\b/, "Dog/Other Dog"),
  m("Banfield", /BANFIELD/, "Dog/Vet"),

  // --- Entertainment ---------------------------------------------------------------
  m("AMC Theatres", /AMC THEATRE|AMC \d/, "Personal/Entertainment"),
  m("Regal", /REGAL CINEMA|REGAL \d/, "Personal/Entertainment"),
  m("Ticketmaster", /TICKETMASTER/, "Personal/Entertainment"),
  m("StubHub", /STUBHUB/, "Personal/Entertainment"),
  m("Eventbrite", /EVENTBRITE/, "Personal/Entertainment"),
  m("Topgolf", /TOPGOLF/, "Personal/Entertainment"),
  m("Steam", /STEAMGAMES|STEAM PURCHASE|STEAMPOWERED/, "Personal/Hobbies"),
  m("PlayStation", /PLAYSTATION|SONY INTERACTIVE/, "Personal/Hobbies"),
  m("Xbox", /\bXBOX\b/, "Personal/Hobbies"),
  m("Nintendo", /NINTENDO/, "Personal/Hobbies"),

  // --- Travel ------------------------------------------------------------------------
  m("Delta Air Lines", /DELTA AIR|\bDELTA \d/, "Travel/Flights"),
  m("United Airlines", /UNITED AIR|UNITED \d{6,}/, "Travel/Flights"),
  m("American Airlines", /AMERICAN AIR|\bAA \d{6,}/, "Travel/Flights"),
  m("Southwest Airlines", /SOUTHWEST AIR|SOUTHWES \d/, "Travel/Flights"),
  m("JetBlue", /JETBLUE/, "Travel/Flights"),
  m("Alaska Airlines", /ALASKA AIR/, "Travel/Flights"),
  m("Spirit Airlines", /SPIRIT AIR/, "Travel/Flights"),
  m("Frontier Airlines", /FRONTIER AIR|FLYFRONTIER/, "Travel/Flights"),
  m("Marriott", /MARRIOTT|RESIDENCE INN|COURTYARD BY/, "Travel/Hotels"),
  m("Hilton", /HILTON|HAMPTON INN|EMBASSY SUITES|DOUBLETREE/, "Travel/Hotels"),
  m("Hyatt", /HYATT/, "Travel/Hotels"),
  m("IHG", /HOLIDAY INN|\bIHG\b/, "Travel/Hotels"),
  m("Airbnb", /AIRBNB/, "Travel/Hotels"),
  m("Vrbo", /\bVRBO\b/, "Travel/Hotels"),
  m("Expedia", /EXPEDIA/, "Travel/Other Travel", false),
  m("Booking.com", /BOOKING\.COM/, "Travel/Hotels"),
  m("Amtrak", /AMTRAK/, "Travel/Transportation"),
  m("Hertz", /\bHERTZ\b/, "Travel/Transportation"),
  m("Enterprise Rent-A-Car", /ENTERPRISE RENT/, "Travel/Transportation"),
  m("Avis", /\bAVIS\b/, "Travel/Transportation"),

  // --- Housing & utilities ---------------------------------------------------------
  m("Dominion Energy", /DOMINION ENERGY|DOM ENERGY/, "Housing/Electricity"),
  m("Pepco", /\bPEPCO\b/, "Housing/Electricity"),
  m("BGE", /\bBGE\b|BALTIMORE GAS/, "Housing/Electricity"),
  m("Duke Energy", /DUKE ENERGY/, "Housing/Electricity"),
  m("Washington Gas", /WASHINGTON GAS|WGL/, "Housing/Other Housing"),
  m("Verizon Fios", /VERIZON ?FIOS|FIOS/, "Housing/Internet"),
  m("Xfinity", /XFINITY|COMCAST/, "Housing/Internet"),
  m("Cox", /\bCOX COMM/, "Housing/Internet"),
  m("Spectrum", /\bSPECTRUM\b/, "Housing/Internet"),
  m("AT&T", /\bAT&T\b|\bATT\b/, "Housing/Internet", false),
  m("Verizon Wireless", /VERIZON WIRELESS|VZWRLSS/, "Housing/Internet", false),
  m("T-Mobile", /T-MOBILE|TMOBILE/, "Housing/Internet", false),

  // --- Gifts & donations ----------------------------------------------------------
  m("GoFundMe", /GOFUNDME/, "Gifts/Donations"),
  m("American Red Cross", /RED CROSS/, "Gifts/Donations"),

  // --- Names only (no default category) ----------------------------------------
  m("PayPal", /^PAYPAL\b|^PP\b/, null),
  m("Square", /^SQUARE\b/, null),
];

/** The library entry a description belongs to, if any. */
export function findKnownMerchant(text: string): KnownMerchant | null {
  const upper = text.toUpperCase();
  return MERCHANT_LIBRARY.find((merchant) => merchant.match.test(upper)) ?? null;
}
