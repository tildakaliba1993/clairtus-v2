const DRC_E164_REGEX = /^\+243[0-9]{9}$/;
const SA_E164_REGEX = /^\+27[0-9]{9}$/;

function allowNonDrcTestNumbers(): boolean {
  return process.env.NEXT_PUBLIC_ALLOW_NON_DRC_TEST_NUMBERS === "true" ||
    process.env.ALLOW_NON_DRC_TEST_NUMBERS === "true";
}

export function isValidDrE164Phone(phone: string): boolean {
  const compact = phone.trim();
  if (DRC_E164_REGEX.test(compact)) {
    return true;
  }
  if (allowNonDrcTestNumbers() && SA_E164_REGEX.test(compact)) {
    return true;
  }
  return false;
}

export function normalizeDrPhoneToE164(input: string): string {
  const compact = input.replaceAll(/\s+/g, "").trim();
  const allowNonDrc = allowNonDrcTestNumbers();

  if (DRC_E164_REGEX.test(compact)) {
    return compact;
  }

  if (allowNonDrc && SA_E164_REGEX.test(compact)) {
    return compact;
  }

  if (/^243[0-9]{9}$/.test(compact)) {
    return `+${compact}`;
  }

  if (allowNonDrc && /^27[0-9]{9}$/.test(compact)) {
    return `+${compact}`;
  }

  if (/^0[0-9]{9}$/.test(compact)) {
    return `+243${compact.slice(1)}`;
  }

  if (allowNonDrc) {
    throw new Error("Invalid phone format. Use +243XXXXXXXXX or +27XXXXXXXXX.");
  }
  throw new Error("Invalid DRC phone format. Use +243XXXXXXXXX.");
}
