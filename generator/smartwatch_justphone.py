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
        'Apple WATCH SE (1ST GEN)',
        'Apple WATCH SERIES 3',
        'Apple WATCH SERIES 4',
        'Apple WATCH SERIES 5',
        'Apple WATCH SERIES 6',
        'Apple WATCH SERIES 7',
        'Apple WATCH SERIES 8',
        'Apple WATCH SERIES 9',
        'Apple WATCH SERIES SE (2ND GEN)',
        'Apple WATCH ULTRA',
        'Apple WATCH ULTRA 2',
        'Samsung GALAXY WATCH 4',
        'Samsung Galaxy Watch4 Classic,46mm, Bluetooth,',
        'Samsung GALAXY WATCH 5 smartwatch',
        'Samsung GALAXY WATCH 5 PRO',
        
    ]
    smartwatch_table = []

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
                1: 'Apple IWATCH SE (1ST GEN)',
                2: 'Apple IWATCH SERIES 3',
                3: 'Apple IWATCH SERIES 4',
                4: 'Apple IWATCH SERIES 5',
                5: 'Apple IWATCH SERIES 6',
                6: 'Apple IWATCH SERIES 7',
                7: 'Apple IWATCH SERIES 8',
                8: 'Apple WATCH SERIES 9',
                9: 'Apple IWATCH SERIES SE (2ND GEN)',
                10: 'Apple IWATCH ULTRA',
                11: 'Apple IWATCH ULTRA 2',
                12: 'Samsung GALAXY WATCH 4',
                13: 'Samsung GALAXY WATCH 4 CLASSIC',
                14: 'Samsung GALAXY WATCH 5',
                15: 'Samsung GALAXY WATCH 5 PRO',
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

        smartwatch_table.append(entry)

    # Allow further testing by leaving the input part
    
    # os.chdir('..')
    with open('src/constants/sites/justfone/smartwatchJUSTPHONE.js', 'w') as js_file:
        js_file.write("export const smartwatchTable = " + json.dumps(smartwatch_table, indent=2))
