import React, { useState, useContext, useMemo } from 'react';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { TimePicker as MuiTimePicker } from '@mui/x-date-pickers/TimePicker';
import { renderTimeViewClock } from '@mui/x-date-pickers/timeViewRenderers';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import dayjs from 'dayjs';
import { ThemeContext } from '../context/ThemeContext';

const TimePicker = ({
  id = "default-timepicker",
  name,
  value,
  onChange,
  placeholder = "Select time",
  label,
}) => {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(null);
  const { isDarkMode } = useContext(ThemeContext);

  const theme = useMemo(() => createTheme({
    palette: {
      mode: isDarkMode ? 'dark' : 'light',
      primary: {
        main: '#2563eb', // brand blue
      },
      background: {
        default: isDarkMode ? '#1e1e1e' : '#ffffff',
        paper: isDarkMode ? '#212121' : '#ffffff',
      },
    },
    components: {
      MuiButtonBase: {
        defaultProps: {
          disableRipple: false,
        },
      },
      MuiClockNumber: {
        styleOverrides: {
          root: {
            // Fix Tailwind CSS overriding MUI box-sizing which breaks the clock dial
            boxSizing: 'content-box',
          }
        }
      },
      MuiClockPointer: {
        styleOverrides: {
          root: {
            boxSizing: 'content-box',
          },
          thumb: {
            boxSizing: 'content-box',
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backdropFilter: 'blur(12px)',
            backgroundColor: isDarkMode ? 'rgba(33, 33, 33, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            borderRadius: '24px', // Softer curve for time picker dial
            boxShadow: isDarkMode ? '0 8px 32px 0 rgba(0, 0, 0, 0.3)' : '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
            border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(255, 255, 255, 0.5)',
          },
        },
      },
    },
  }), [isDarkMode]);

  // Parse incoming value, assuming HH:mm string (24-hour format from state)
  const isControlled = value !== undefined;
  const parsedValue = isControlled 
    ? (value ? dayjs(`2000-01-01T${value}`) : null)
    : internalValue;

  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label htmlFor={id} className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {label}
        </label>
      )}
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <MuiTimePicker
            value={parsedValue}
            minutesStep={5}
            ampm={true}
            ampmInClock={true}
            format="hh:mm A"
            viewRenderers={{
              hours: renderTimeViewClock,
              minutes: renderTimeViewClock,
              seconds: renderTimeViewClock,
            }}
            onChange={(newValue) => {
              if (!isControlled) {
                setInternalValue(newValue);
              }
              if (onChange) {
                 // Provide value as 24-hour HH:mm string compatible with our handlers
                 onChange({ target: { name: name || id, id, value: newValue ? newValue.format('HH:mm') : '' } });
              }
            }}
            slotProps={{
              toolbar: { hidden: false }, // Shows the toolbar with time & edit icon
              textField: {
              size: 'small',
              placeholder: placeholder,
              id: id,
              name: name || id,
              fullWidth: true,
              sx: {
                backgroundColor: isDarkMode ? '#212121' : '#ffffff',
                '& .MuiInputBase-input': {
                   color: isDarkMode ? '#f1f1f1' : '#1e293b',
                },
                '& .MuiOutlinedInput-root': {
                   borderRadius: '8px',
                   fontSize: '14px',
                },
                '& .MuiOutlinedInput-notchedOutline': {
                   borderColor: isDarkMode ? '#3f3f3f' : '#cbd5e1',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                   borderColor: isDarkMode ? '#555555' : '#94a3b8',
                }
              }
            }
          }}
        />
      </LocalizationProvider>
      </ThemeProvider>
    </div>
  );
};

export default TimePicker;
