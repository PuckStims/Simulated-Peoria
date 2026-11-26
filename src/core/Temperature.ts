/** Presentation-only temperature conversion. Environmental state remains Celsius. */
export function celsiusToFahrenheit(celsius: number): number {
  return celsius * (9 / 5) + 32;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) * (5 / 9);
}

export function formatFahrenheit(celsius: number, digits = 1): string {
  return `${celsiusToFahrenheit(celsius).toFixed(digits)}°F`;
}
