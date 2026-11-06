
import { fetchWeatherApi } from "openmeteo";

async function main() {
    const params = {
        latitude: 52.52,
        longitude: 13.41,
        hourly: [
            "temperature_2m",
            "soil_temperature_0cm",
            "soil_temperature_6cm",
            "soil_temperature_18cm",
            "soil_temperature_54cm",
            "soil_moisture_0_to_1cm",
            "soil_moisture_1_to_3cm",
            "soil_moisture_3_to_9cm",
            "soil_moisture_9_to_27cm",
            "soil_moisture_27_to_81cm",
            "wind_speed_10m",
            "wind_speed_80m",
            "temperature_80m",
            "rain",
            "precipitation_probability",
            "relative_humidity_2m",
            "evapotranspiration",
            "et0_fao_evapotranspiration",
            "direct_radiation",
            "is_day",
        ],
        current: ["rain"],
        forecast_days: 3,
    };

    const url = "https://api.open-meteo.com/v1/forecast";
    const responses = await fetchWeatherApi(url, params);

    // Process the first location
    const response = responses[0];

    // Location attributes
    const latitude = response.latitude();
    const longitude = response.longitude();
    const elevation = response.elevation();
    const utcOffsetSeconds = response.utcOffsetSeconds();

    console.log(
        `\nCoordinates: ${latitude}°N ${longitude}°E`,
        `\nElevation: ${elevation}m asl`,
        `\nTimezone difference to GMT+0: ${utcOffsetSeconds}s`,
    );

    const current = response.current()!;
    const hourly = response.hourly()!;

    // Current weather data
    const weatherData = {
        current: {
            time: new Date(
                (Number(current.time()) + utcOffsetSeconds) * 1000
            ),
            rain: current.variables(0)!.value(),
        },

        // Hourly weather data
        hourly: {
            time: Array.from(
                {
                    length:
                        (Number(hourly.timeEnd()) -
                            Number(hourly.time())) /
                        hourly.interval(),
                },
                (_, i) =>
                    new Date(
                        (Number(hourly.time()) +
                            i * hourly.interval() +
                            utcOffsetSeconds) *
                            1000
                    )
            ),

            temperature_2m: hourly.variables(0)!.valuesArray(),
            soil_temperature_0cm: hourly.variables(1)!.valuesArray(),
            soil_temperature_6cm: hourly.variables(2)!.valuesArray(),
            soil_temperature_18cm: hourly.variables(3)!.valuesArray(),
            soil_temperature_54cm: hourly.variables(4)!.valuesArray(),

            soil_moisture_0_to_1cm: hourly.variables(5)!.valuesArray(),
            soil_moisture_1_to_3cm: hourly.variables(6)!.valuesArray(),
            soil_moisture_3_to_9cm: hourly.variables(7)!.valuesArray(),
            soil_moisture_9_to_27cm: hourly.variables(8)!.valuesArray(),
            soil_moisture_27_to_81cm: hourly.variables(9)!.valuesArray(),

            wind_speed_10m: hourly.variables(10)!.valuesArray(),
            wind_speed_80m: hourly.variables(11)!.valuesArray(),
            temperature_80m: hourly.variables(12)!.valuesArray(),

            rain: hourly.variables(13)!.valuesArray(),
            precipitation_probability: hourly.variables(14)!.valuesArray(),
            relative_humidity_2m: hourly.variables(15)!.valuesArray(),

            evapotranspiration: hourly.variables(16)!.valuesArray(),
            et0_fao_evapotranspiration: hourly.variables(17)!.valuesArray(),

            direct_radiation: hourly.variables(18)!.valuesArray(),
            is_day: hourly.variables(19)!.valuesArray(),
        },
    };

    console.log(
        `\nCurrent time: ${weatherData.current.time}\n`,
        weatherData.current.rain
    );

    console.log("\nHourly data:\n", weatherData.hourly);
}

main().catch((error) => {
    console.error("Failed to fetch Open-Meteo data:", error);
});
