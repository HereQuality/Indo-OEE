import React, { useContext, useMemo } from "react";
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { TimePicker as MuiTimePicker } from '@mui/x-date-pickers/TimePicker';
import { renderTimeViewClock } from '@mui/x-date-pickers/timeViewRenderers';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import dayjs from "dayjs";
import { Clock } from "lucide-react";
import { ThemeContext } from "../../context/ThemeContext";

/**
 * Clock Dial Time Picker - requested by user ("chakra vala")
 */
const TimePicker = ({
  value,
  onChange,
  name,
  placeholder = "--:--",
  hasError = false,
}) => {
  const { isDarkMode } = useContext(ThemeContext);

  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: isDarkMode ? 'dark' : 'light',
          primary: {
            main: '#2563eb', // brand-600
          },
        },
      }),
    [isDarkMode],
  );
  const handleTimeChange = (newValue) => {
    if (!newValue || !newValue.isValid()) {
      onChange({ target: { name, value: "" } });
      return;
    }
    const formatted = newValue.format('HH:mm');
    onChange({ target: { name, value: formatted } });
  };

  const parsedValue = value ? dayjs(`2024-01-01T${value}`) : null;

  return (
    <div className="w-full bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-xl">
    <ThemeProvider theme={muiTheme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
      <MuiTimePicker
        value={parsedValue}
        onChange={handleTimeChange}
        minutesStep={5}
        viewRenderers={{
          hours: renderTimeViewClock,
          minutes: renderTimeViewClock,
          seconds: renderTimeViewClock,
        }}
        format="hh:mm A"
        slotProps={{
          textField: {
            placeholder,
            error: hasError,
            fullWidth: true,
            size: "small",
            sx: {
              '& .MuiInputBase-root': {
                height: '36px',
                borderRadius: '0.75rem',
                fontSize: '0.75rem',
                fontFamily: 'inherit',
                color: 'inherit',
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: hasError ? '#f87171' : 'rgba(203, 213, 225, 1)', // slate-300
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: hasError ? '#ef4444' : '#94a3b8',
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: hasError ? '#ef4444' : '#2563eb', // brand-600
                borderWidth: '1px',
              },
            }
          },
          openPickerButton: {
            size: 'small',
          }
        }}
      />
      </LocalizationProvider>
    </ThemeProvider>
    </div>
  );
};

export default TimePicker;
