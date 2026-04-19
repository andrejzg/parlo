import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/lib/animations";

interface PhoneScreenProps {
  onNext: (phone: string) => void | Promise<void>;
  onBack?: () => void;
  initialValue?: string;
}

const COUNTRY_CODES = [
  { code: "+93", iso: "af", label: "AF +93" },
  { code: "+355", iso: "al", label: "AL +355" },
  { code: "+213", iso: "dz", label: "DZ +213" },
  { code: "+376", iso: "ad", label: "AD +376" },
  { code: "+244", iso: "ao", label: "AO +244" },
  { code: "+54", iso: "ar", label: "AR +54" },
  { code: "+374", iso: "am", label: "AM +374" },
  { code: "+61", iso: "au", label: "AU +61" },
  { code: "+43", iso: "at", label: "AT +43" },
  { code: "+994", iso: "az", label: "AZ +994" },
  { code: "+973", iso: "bh", label: "BH +973" },
  { code: "+880", iso: "bd", label: "BD +880" },
  { code: "+375", iso: "by", label: "BY +375" },
  { code: "+32", iso: "be", label: "BE +32" },
  { code: "+501", iso: "bz", label: "BZ +501" },
  { code: "+229", iso: "bj", label: "BJ +229" },
  { code: "+975", iso: "bt", label: "BT +975" },
  { code: "+591", iso: "bo", label: "BO +591" },
  { code: "+387", iso: "ba", label: "BA +387" },
  { code: "+267", iso: "bw", label: "BW +267" },
  { code: "+55", iso: "br", label: "BR +55" },
  { code: "+673", iso: "bn", label: "BN +673" },
  { code: "+359", iso: "bg", label: "BG +359" },
  { code: "+226", iso: "bf", label: "BF +226" },
  { code: "+257", iso: "bi", label: "BI +257" },
  { code: "+855", iso: "kh", label: "KH +855" },
  { code: "+237", iso: "cm", label: "CM +237" },
  { code: "+1", iso: "ca", label: "CA +1" },
  { code: "+238", iso: "cv", label: "CV +238" },
  { code: "+236", iso: "cf", label: "CF +236" },
  { code: "+235", iso: "td", label: "TD +235" },
  { code: "+56", iso: "cl", label: "CL +56" },
  { code: "+86", iso: "cn", label: "CN +86" },
  { code: "+57", iso: "co", label: "CO +57" },
  { code: "+243", iso: "cd", label: "CD +243" },
  { code: "+242", iso: "cg", label: "CG +242" },
  { code: "+506", iso: "cr", label: "CR +506" },
  { code: "+385", iso: "hr", label: "HR +385" },
  { code: "+53", iso: "cu", label: "CU +53" },
  { code: "+357", iso: "cy", label: "CY +357" },
  { code: "+420", iso: "cz", label: "CZ +420" },
  { code: "+225", iso: "ci", label: "CI +225" },
  { code: "+45", iso: "dk", label: "DK +45" },
  { code: "+253", iso: "dj", label: "DJ +253" },
  { code: "+593", iso: "ec", label: "EC +593" },
  { code: "+20", iso: "eg", label: "EG +20" },
  { code: "+503", iso: "sv", label: "SV +503" },
  { code: "+240", iso: "gq", label: "GQ +240" },
  { code: "+291", iso: "er", label: "ER +291" },
  { code: "+372", iso: "ee", label: "EE +372" },
  { code: "+268", iso: "sz", label: "SZ +268" },
  { code: "+251", iso: "et", label: "ET +251" },
  { code: "+679", iso: "fj", label: "FJ +679" },
  { code: "+358", iso: "fi", label: "FI +358" },
  { code: "+33", iso: "fr", label: "FR +33" },
  { code: "+241", iso: "ga", label: "GA +241" },
  { code: "+220", iso: "gm", label: "GM +220" },
  { code: "+995", iso: "ge", label: "GE +995" },
  { code: "+49", iso: "de", label: "DE +49" },
  { code: "+233", iso: "gh", label: "GH +233" },
  { code: "+30", iso: "gr", label: "GR +30" },
  { code: "+502", iso: "gt", label: "GT +502" },
  { code: "+224", iso: "gn", label: "GN +224" },
  { code: "+592", iso: "gy", label: "GY +592" },
  { code: "+509", iso: "ht", label: "HT +509" },
  { code: "+504", iso: "hn", label: "HN +504" },
  { code: "+852", iso: "hk", label: "HK +852" },
  { code: "+36", iso: "hu", label: "HU +36" },
  { code: "+354", iso: "is", label: "IS +354" },
  { code: "+91", iso: "in", label: "IN +91" },
  { code: "+62", iso: "id", label: "ID +62" },
  { code: "+98", iso: "ir", label: "IR +98" },
  { code: "+964", iso: "iq", label: "IQ +964" },
  { code: "+353", iso: "ie", label: "IE +353" },
  { code: "+972", iso: "il", label: "IL +972" },
  { code: "+39", iso: "it", label: "IT +39" },
  { code: "+1876", iso: "jm", label: "JM +1876" },
  { code: "+81", iso: "jp", label: "JP +81" },
  { code: "+962", iso: "jo", label: "JO +962" },
  { code: "+7", iso: "kz", label: "KZ +7" },
  { code: "+254", iso: "ke", label: "KE +254" },
  { code: "+82", iso: "kr", label: "KR +82" },
  { code: "+965", iso: "kw", label: "KW +965" },
  { code: "+996", iso: "kg", label: "KG +996" },
  { code: "+856", iso: "la", label: "LA +856" },
  { code: "+371", iso: "lv", label: "LV +371" },
  { code: "+961", iso: "lb", label: "LB +961" },
  { code: "+266", iso: "ls", label: "LS +266" },
  { code: "+231", iso: "lr", label: "LR +231" },
  { code: "+218", iso: "ly", label: "LY +218" },
  { code: "+423", iso: "li", label: "LI +423" },
  { code: "+370", iso: "lt", label: "LT +370" },
  { code: "+352", iso: "lu", label: "LU +352" },
  { code: "+853", iso: "mo", label: "MO +853" },
  { code: "+261", iso: "mg", label: "MG +261" },
  { code: "+265", iso: "mw", label: "MW +265" },
  { code: "+60", iso: "my", label: "MY +60" },
  { code: "+960", iso: "mv", label: "MV +960" },
  { code: "+223", iso: "ml", label: "ML +223" },
  { code: "+356", iso: "mt", label: "MT +356" },
  { code: "+222", iso: "mr", label: "MR +222" },
  { code: "+230", iso: "mu", label: "MU +230" },
  { code: "+52", iso: "mx", label: "MX +52" },
  { code: "+373", iso: "md", label: "MD +373" },
  { code: "+377", iso: "mc", label: "MC +377" },
  { code: "+976", iso: "mn", label: "MN +976" },
  { code: "+382", iso: "me", label: "ME +382" },
  { code: "+212", iso: "ma", label: "MA +212" },
  { code: "+258", iso: "mz", label: "MZ +258" },
  { code: "+95", iso: "mm", label: "MM +95" },
  { code: "+264", iso: "na", label: "NA +264" },
  { code: "+977", iso: "np", label: "NP +977" },
  { code: "+31", iso: "nl", label: "NL +31" },
  { code: "+64", iso: "nz", label: "NZ +64" },
  { code: "+505", iso: "ni", label: "NI +505" },
  { code: "+227", iso: "ne", label: "NE +227" },
  { code: "+234", iso: "ng", label: "NG +234" },
  { code: "+389", iso: "mk", label: "MK +389" },
  { code: "+47", iso: "no", label: "NO +47" },
  { code: "+968", iso: "om", label: "OM +968" },
  { code: "+92", iso: "pk", label: "PK +92" },
  { code: "+970", iso: "ps", label: "PS +970" },
  { code: "+507", iso: "pa", label: "PA +507" },
  { code: "+675", iso: "pg", label: "PG +675" },
  { code: "+595", iso: "py", label: "PY +595" },
  { code: "+51", iso: "pe", label: "PE +51" },
  { code: "+63", iso: "ph", label: "PH +63" },
  { code: "+48", iso: "pl", label: "PL +48" },
  { code: "+351", iso: "pt", label: "PT +351" },
  { code: "+1787", iso: "pr", label: "PR +1787" },
  { code: "+974", iso: "qa", label: "QA +974" },
  { code: "+40", iso: "ro", label: "RO +40" },
  { code: "+7", iso: "ru", label: "RU +7" },
  { code: "+250", iso: "rw", label: "RW +250" },
  { code: "+966", iso: "sa", label: "SA +966" },
  { code: "+221", iso: "sn", label: "SN +221" },
  { code: "+381", iso: "rs", label: "RS +381" },
  { code: "+248", iso: "sc", label: "SC +248" },
  { code: "+232", iso: "sl", label: "SL +232" },
  { code: "+65", iso: "sg", label: "SG +65" },
  { code: "+421", iso: "sk", label: "SK +421" },
  { code: "+386", iso: "si", label: "SI +386" },
  { code: "+252", iso: "so", label: "SO +252" },
  { code: "+27", iso: "za", label: "ZA +27" },
  { code: "+211", iso: "ss", label: "SS +211" },
  { code: "+34", iso: "es", label: "ES +34" },
  { code: "+94", iso: "lk", label: "LK +94" },
  { code: "+249", iso: "sd", label: "SD +249" },
  { code: "+597", iso: "sr", label: "SR +597" },
  { code: "+46", iso: "se", label: "SE +46" },
  { code: "+41", iso: "ch", label: "CH +41" },
  { code: "+963", iso: "sy", label: "SY +963" },
  { code: "+886", iso: "tw", label: "TW +886" },
  { code: "+992", iso: "tj", label: "TJ +992" },
  { code: "+255", iso: "tz", label: "TZ +255" },
  { code: "+66", iso: "th", label: "TH +66" },
  { code: "+228", iso: "tg", label: "TG +228" },
  { code: "+676", iso: "to", label: "TO +676" },
  { code: "+1868", iso: "tt", label: "TT +1868" },
  { code: "+216", iso: "tn", label: "TN +216" },
  { code: "+90", iso: "tr", label: "TR +90" },
  { code: "+993", iso: "tm", label: "TM +993" },
  { code: "+256", iso: "ug", label: "UG +256" },
  { code: "+380", iso: "ua", label: "UA +380" },
  { code: "+971", iso: "ae", label: "AE +971" },
  { code: "+44", iso: "gb", label: "GB +44" },
  { code: "+1", iso: "us", label: "US +1" },
  { code: "+598", iso: "uy", label: "UY +598" },
  { code: "+998", iso: "uz", label: "UZ +998" },
  { code: "+678", iso: "vu", label: "VU +678" },
  { code: "+58", iso: "ve", label: "VE +58" },
  { code: "+84", iso: "vn", label: "VN +84" },
  { code: "+967", iso: "ye", label: "YE +967" },
  { code: "+260", iso: "zm", label: "ZM +260" },
  { code: "+263", iso: "zw", label: "ZW +263" },
];

function flagUrl(iso: string) {
  return `https://api.iconify.design/flag/${iso}-4x3.svg`;
}

/** Find country code entry by ISO code (case-insensitive) */
function findByIso(iso: string) {
  return COUNTRY_CODES.find((cc) => cc.iso === iso.toLowerCase());
}

/** Fallback: detect from browser locale */
function detectFromLocale(): string {
  try {
    const locale = navigator.language || navigator.languages?.[0] || "";
    const parts = locale.split("-");
    if (parts.length >= 2) {
      const match = findByIso(parts[parts.length - 1]);
      if (match) return match.code;
    }
  } catch {
    // Ignore
  }
  return "+1";
}

export default function PhoneScreen({ onNext, onBack, initialValue = "" }: PhoneScreenProps) {
  // Parse initial value back into country code + local number
  const parsedInitial = (() => {
    if (!initialValue) return { code: "", local: "" };
    const match = COUNTRY_CODES.slice().sort((a, b) => b.code.length - a.code.length)
      .find((cc) => initialValue.startsWith(cc.code));
    if (match) return { code: match.code, local: initialValue.slice(match.code.length) };
    return { code: "", local: initialValue };
  })();

  const [countryCode, setCountryCode] = useState(() => parsedInitial.code || detectFromLocale());
  const [geoLoaded, setGeoLoaded] = useState(!!parsedInitial.code);

  // Fetch real country from Cloudflare edge (IP-based, most accurate)
  useEffect(() => {
    if (geoLoaded) return;
    fetch("/api/geo")
      .then((r) => r.json())
      .then((data: { country?: string }) => {
        if (data.country) {
          const match = findByIso(data.country);
          if (match) setCountryCode(match.code);
        }
      })
      .catch(() => {})
      .finally(() => setGeoLoaded(true));
  }, [geoLoaded]);
  const [phone, setPhone] = useState(parsedInitial.local);
  const [submitting, setSubmitting] = useState(false);

  /** Detect if a value contains a country code (from autofill) and split it out.
   *  Handles: "+447440018933", "00447440018933", "+1 234 567 8901" etc. */
  const handlePhoneChange = (raw: string) => {
    // Strip all non-digit/+ chars for detection
    const cleaned = raw.replace(/[^\d+]/g, "");

    // If it starts with + or 00, try to extract a country code
    if (cleaned.startsWith("+") || cleaned.startsWith("00")) {
      const normalized = cleaned.startsWith("00") ? "+" + cleaned.slice(2) : cleaned;
      // Try longest country codes first to match correctly (e.g. +1876 before +1)
      const sorted = COUNTRY_CODES.slice().sort((a, b) => b.code.length - a.code.length);
      const match = sorted.find((cc) => normalized.startsWith(cc.code));
      if (match) {
        setCountryCode(match.code);
        // Local number is everything after the country code, strip leading zeros
        const local = normalized.slice(match.code.length).replace(/^0+/, "");
        setPhone(local);
        return;
      }
    }

    // No country code detected — just set the raw value
    setPhone(raw);
  };

  const canSubmit = phone.replace(/\D/g, "").length >= 7 && !submitting;
  const selectedCountry = COUNTRY_CODES.find((cc) => cc.code === countryCode);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Strip leading zeros from local number — e.g. +44 + 07976... → +447976...
      const local = phone.replace(/\D/g, "").replace(/^0+/, "");
      await onNext(`${countryCode}${local}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-6 pt-6 pb-safe sm:py-12"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Top row: back button + brand mark */}
      <motion.div variants={fadeUp} className="w-full flex items-center justify-between">
        {onBack ? (
          <motion.button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 px-2 py-2 -ml-2 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            whileTap={{ scale: 0.9 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="text-sm">Back</span>
          </motion.button>
        ) : (
          <div className="w-10" />
        )}
        <div className="flex items-center gap-2 opacity-50">
          <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
          <span className="text-xs font-display tracking-widest uppercase text-muted-foreground">
            Parlo
          </span>
        </div>
        <div className="w-10" />
      </motion.div>

      {/* Main content */}
      <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto">
        <motion.h2
          variants={fadeUp}
          className="font-display text-xl sm:text-3xl leading-snug text-center text-foreground"
          style={{ fontWeight: 800 }}
        >
          What's your phone number?
        </motion.h2>

        <motion.p
          variants={fadeUp}
          className="text-muted-foreground text-base text-center font-light"
        >
          We'll only contact you about this survey.
        </motion.p>

        {/* Phone input */}
        <motion.div variants={fadeUp} className="w-full flex gap-2 min-w-0">
          <div
            className="shrink-0 relative h-14 rounded-2xl border"
            style={{
              background: "hsl(225 15% 10%)",
              borderColor: "hsl(225 15% 18%)",
            }}
          >
            {/* Display: flag + code — size to content so narrow viewports
                (e.g. iPhone SE at 375px) don't squeeze the phone input. */}
            <div className="relative flex items-center gap-2 px-3 h-full pointer-events-none">
              {selectedCountry && (
                <img
                  src={flagUrl(selectedCountry.iso)}
                  alt={`${selectedCountry.iso.toUpperCase()} flag`}
                  className="w-5 h-4 rounded-[2px] object-cover shrink-0"
                />
              )}
              <span style={{ color: "hsl(40 20% 95%)", fontSize: "0.9rem" }}>{countryCode}</span>
            </div>
            {/* Invisible native select */}
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              aria-label="Country code"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              {COUNTRY_CODES.map((cc) => (
                <option key={cc.code} value={cc.code}>
                  {cc.label}
                </option>
              ))}
            </select>
          </div>
          <input
            type="tel"
            value={phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="Phone number"
            aria-label="Phone number"
            autoFocus
            autoComplete="tel"
            data-1p-ignore
            data-lpignore="true"
            className="min-w-0 flex-1 h-14 rounded-2xl border px-4 text-lg ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{
              background: "hsl(225 15% 10%)",
              color: "hsl(40 20% 95%)",
              borderColor: "hsl(225 15% 18%)",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
        </motion.div>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="w-full max-w-xs">
        <motion.button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-display text-lg tracking-wide glow-primary disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontWeight: 700 }}
          whileTap={canSubmit ? { scale: 0.96, transition: { duration: 0.08 } } : {}}
          whileHover={canSubmit ? { filter: "brightness(1.12)", transition: { duration: 0.15 } } : {}}
        >
          {submitting ? "Sending..." : "Next"}
        </motion.button>
        <p className="text-[10px] text-muted-foreground/60 text-center mt-3 leading-tight">
          Protected by reCAPTCHA. Google{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Privacy
          </a>{" "}
          &{" "}
          <a
            href="https://policies.google.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Terms
          </a>
          .
        </p>
      </motion.div>
    </motion.div>
  );
}
