export function generatePassword(length = 6) {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";

  // Ensure at least one of each
  let password =
    uppercase[Math.floor(Math.random() * uppercase.length)] +
    lowercase[Math.floor(Math.random() * lowercase.length)] +
    digits[Math.floor(Math.random() * digits.length)];

  // Fill the rest randomly
  const allChars = uppercase + lowercase + digits;
  while (password.length < length) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle to make it less predictable
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}
export function formatTime(hour: string | number): string {
  const h =
    typeof hour === 'string'
      ? parseInt(hour.split(':')[0], 10)
      : hour;

  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  if (h > 12) return `${h - 12} PM`;
  return `${h} AM`;
}

