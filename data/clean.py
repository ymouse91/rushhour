# tallenna tiedostoon: filter_rush.py
# Käyttö: python filter_rush.py
# Lukee rush.txt ja kirjoittaa rushx.txt, jättäen pois rivit joissa on kirjain 'x'.

def main():
    in_name = "rush.txt"
    out_name = "rushx.txt"

    # Luetaan koko tiedosto
    with open(in_name, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Suodatetaan pois rivit, joissa on 'x'
    kept = [line for line in lines if 'x' not in line]

    # Kirjoitetaan tulos
    with open(out_name, "w", encoding="utf-8") as f:
        f.writelines(kept)

    # (valinnainen) pieni yhteenveto
    print(f"Rivejä yhteensä: {len(lines)}")
    print(f"Poistettuja (sisälsivät 'x'): {len(lines) - len(kept)}")
    print(f"Talletettu: {out_name} ({len(kept)} riviä)")

if __name__ == "__main__":
    main()
