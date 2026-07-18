from app.routes.places import _dedupe_place_suggestions


def test_dedupe_prefers_city_over_capital_territory_and_bare_label():
    items = [
        {
            "placeId": "1",
            "label": "Islamabad, Pakistan",
            "mainText": "Islamabad",
            "secondaryText": "Pakistan",
            "types": ["locality", "political", "geocode"],
        },
        {
            "placeId": "2",
            "label": "Islamabad Capital Territory, Pakistan",
            "mainText": "Islamabad Capital Territory",
            "secondaryText": "Pakistan",
            "types": ["administrative_area_level_1", "political", "geocode"],
        },
        {
            "placeId": "3",
            "label": "Islamabad",
            "mainText": "Islamabad",
            "secondaryText": "",
            "types": ["locality", "political", "geocode"],
        },
        {
            "placeId": "4",
            "label": "Islamabad, Gujranwala, Punjab, Pakistan",
            "mainText": "Islamabad",
            "secondaryText": "Gujranwala, Punjab, Pakistan",
            "types": ["locality", "political", "geocode"],
        },
        {
            "placeId": "5",
            "label": "Islamabad Chhilora, Uttar Pradesh, India",
            "mainText": "Islamabad Chhilora",
            "secondaryText": "Uttar Pradesh, India",
            "types": ["locality", "political", "geocode"],
        },
    ]

    labels = [item["label"] for item in _dedupe_place_suggestions(items)]
    assert labels[0] == "Islamabad, Pakistan"
    assert "Islamabad Capital Territory, Pakistan" not in labels
    assert "Islamabad" not in labels  # bare label collapsed
    assert "Islamabad, Gujranwala, Punjab, Pakistan" in labels
    assert "Islamabad Chhilora, Uttar Pradesh, India" in labels


def test_dedupe_keeps_state_when_same_named_city_has_region():
    items = [
        {
            "placeId": "1",
            "label": "California, MO, USA",
            "mainText": "California",
            "secondaryText": "MO, USA",
            "types": ["locality", "political", "geocode"],
        },
        {
            "placeId": "2",
            "label": "California, USA",
            "mainText": "California",
            "secondaryText": "USA",
            "types": ["administrative_area_level_1", "political", "geocode"],
        },
    ]

    labels = [item["label"] for item in _dedupe_place_suggestions(items)]
    assert "California, MO, USA" in labels
    assert "California, USA" in labels
