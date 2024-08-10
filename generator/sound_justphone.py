import requests
import json
import os
from bs4 import BeautifulSoup

def tokenize(name):
    # Lowercase the name and split by spaces and hyphens
    return set(name.lower().replace('-', ' ').split())

def get_product_info(product_name):
    base_url = 'https://www.justfones.ng/catalogsearch/result/?q='
    search_url = base_url + product_name.replace(' ', '+')

    try:
        response = requests.get(search_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        product_elements = soup.find_all('li', class_='item product product-item')

        if not product_elements:
            print(f"Product not available for '{product_name}'.")
            return {
                'first_three_lowest': [],
                'first_three_highest': []
            }

        input_tokens = tokenize(product_name)
        product_data = []

        for element in product_elements:
            name_element = element.find('h3', class_='product-item-name')
            price_element = element.find('span', class_='price-wrapper')

            if name_element and price_element:
                scraped_name = name_element.text.lower()
                scraped_tokens = tokenize(scraped_name)

                # Compare the tokens
                match_score = len(input_tokens & scraped_tokens) / len(input_tokens)
                # Define a threshold for what constitutes a "match"
                if match_score > 0.6:  # Adjust the threshold as needed
                    price_text = price_element.text.strip()

                    # Handling price ranges
                    if ' - ' in price_text:
                        price_range = price_text.split(' - ')
                        average_price = sum([float(p.replace('₦', '').replace(',', '')) for p in price_range]) / len(price_range)
                        price = f'₦ {average_price:,.0f}'
                    else:
                        price = price_text.replace('₦', '').replace(',', '')
                        price = f'₦ {float(price):,.0f}'

                    product_data.append({'price': price, 'name': product_name})

        # Sort products by price
        sorted_products = sorted(product_data, key=lambda x: float(x['price'].replace('₦', '').replace(',', '')))
        first_three_lowest = sorted_products[:3]
        first_three_highest = sorted_products[-3:]

        return {
            'first_three_lowest': first_three_lowest,
            'first_three_highest': first_three_highest
        }

    except requests.RequestException as e:
        print(f"Error during the request: {e}")
        return None
    


# Rest of the code remains the same
def print_product_info(products, label):
    if products:
        print(f"\n{label} Product Information:")
        for product in products:
            print(f"Name: {product['name']}\n{'-'*30}\nPrice: {product['price']}\n{'-'*30}")
    else:
        print(f"\nProduct not Found.")


if __name__ == "__main__":
    
    product_names = [
        'Apple Airpods 2 WIth Charging Case',
        'Apple AIRPOD PRO 1ST GEN',
        'Apple AIRPODS 3 2021',
        'Apple Airpods Pro ( 2nd Generation )',
        'SAMSUNG galaxy BUDS2,',
        'SAMSUNG galaxy BUDS 2 PRO',
        'SAMSUNG galaxy BUDS',
        'SAMSUNG galaxy BUDS LIVE',
        'SAMSUNG galaxy EARBUDS PLUS',
        'SAMSUNG galaxy EARBUDS PRO',
        'SAMSUNG galaxy BUDS LIVE',
        'Samsung Galaxy Buds2,',
        'Samsung Galaxy Type C Wired Earphones',
        'Beats By Dre Beats Fit Pro',
        'Beats By Dre Beats Studio Buds',
        'Beats By Dre Beats Powerbeats Pro Wireless Earbud',
        
    ]
    sound_table = []

    for index, product_name in enumerate(product_names, start=1):
        print(f"\n*** Searching for '{product_name}' ***")
        results = get_product_info(product_name)

        if results and 'first_three_lowest' in results:
            # Extract prices and ensure there are at least three prices for highest and lowest
            prices_lowest = [float(product['price'].replace('₦', '').replace(',', '')) for product in results['first_three_lowest']]
        else:
            # Handle the case when results or 'first_three_lowest' is None
            prices_lowest = []

        prices_lowest += [0.0] * (3 - len(prices_lowest))

        if results and 'first_three_highest' in results:
            prices_highest = [float(product['price'].replace('₦', '').replace(',', '')) for product in results['first_three_highest']]
        else:
            # Handle the case when results or 'first_three_highest' is None
            prices_highest = []

        prices_highest += [0.0] * (3 - len(prices_highest))
            
            # Assign specific product names based on the index
        assigned_product_name = {
                1: 'Apple AIRPOD 2 CHARGING CASE',
                2: 'Apple AIRPOD PRO 1ST GEN',
                3: 'Apple AIRPODS 3 2021',
                4: 'Apple AIRPODS PRO 2ND GEN',
                5: 'SAMSUNG BUDS 2',
                6: 'SAMSUNG BUDS 2 PRO',
                7: 'SAMSUNG EARBUDS',
                8: 'SAMSUNG EARBUDS LIVE',
                9: 'SAMSUNG EARBUDS PLUS',
                10: 'SAMSUNG EARBUDS PRO',
                11: 'SAMSUNG EARBUDS pro',
                12: 'Samsung Galaxy Buds Live – Mystic Black',
                13: 'Samsung Galaxy Buds2',
                14: 'Samsung usb c akg earphones',
                15: 'BEATS FIT PRO',
                16: 'BEATS STUDIO BUDS',
                17: 'POWERBEATS PRO',

                # Add other product names here
            }.get(index, f"Unknown Product {index}")


            # Constructing the JavaScript format
        entry = {
            'id': index,
            'Pname': assigned_product_name,
            'Link': f"https://www.justfones.ng/catalogsearch/result/?q={product_name.replace(' ', '+')}",
            'H1': f"{prices_highest[0]:,.0f}",
            'H2': f"{prices_highest[1]:,.0f}",
            'H3': f"{prices_highest[2]:,.0f}",
            'L1': f"{prices_lowest[0]:,.0f}",
            'L2': f"{prices_lowest[1]:,.0f}",
            'L3': f"{prices_lowest[2]:,.0f}",
            }

        sound_table.append(entry)

    # Allow further testing by leaving the input part
    
    # os.chdir('..')
    with open('src/constants/sites/justfone/soundJUSTPHONE.js', 'w') as js_file:
        js_file.write("export const soundTable = " + json.dumps(sound_table, indent=2))
