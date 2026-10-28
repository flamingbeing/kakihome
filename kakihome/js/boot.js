// Runs first: this device's look, theme and density from the UI kit (@core/theme), before the first paint, so a chosen
// look never flashes the default one. The app's accent is the home kit's blue, on the cool ground (#f2f2f7, nearest
// the original #f5f5f7); the look is the kit's default (A).
import { applyTheme } from '@core/theme';

applyTheme({ accent: '#3a6390', surface: 'cool' });
