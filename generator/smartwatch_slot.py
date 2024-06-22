import requests
import json
from bs4 import BeautifulSoup

def get_product_info(product_name):
    # Function to scrape Jumia search results for the given product_name
    base_url = 'https://slot.ng/catalogsearch/result/?q='
    search_url = base_url + product_name.replace(' ', '+')

    try:
        response = requests.get(search_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        product_elements = soup.find_all('div', class_='product-info')

        if not product_elements:
            print(f"Product not available for '{product_name}'.")
            return {
                'first_three_lowest': [],
                'first_three_highest': []
            }

        product_data = []
        for element in product_elements:
            name_element = element.find('h3', class_='product-name')
            price_element = element.find('span', class_='price')

            if name_element and price_element:
                # Special case for "apple iphone 13 6.1" 128gb"
                if product_name in [
                    'Apple IWATCH SE (1ST GEN)',
                    'Apple IWATCH ULTRA',
                    ]:
                    name_words = name_element.text.lower().split()[:3]
                    input_words = product_name.lower().split()[:3]

                elif product_name in [
                    'Samsung GALAXY WATCH 5 PRO',
                    'Samsung GALAXY WATCH 4 CLASSIC',
                    ]:
                    name_words = name_element.text.lower().split()[:5]
                    input_words = product_name.lower().split()[:5]
                else:
                    name_words = name_element.text.lower().split()[:4]
                    input_words = product_name.lower().split()[:4]
                    

                # Check if the first four words match
                if name_words == input_words:
                    name = name_element.text.strip()
                    price = price_element.text.strip()
                   
                    product_data.append({'name': name,'price': price})

        # Sort products by price
        sorted_products = sorted(product_data, key=lambda x: float(x['price'].replace('₦', '').replace(',', '')))

        # Extract the first three lowest and the first three highest
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
        print(f"\nNo information available for {label}.")

if __name__ == "__main__":
    product_names = [
        'Apple IWATCH SE (1ST GEN)',
        'Apple IWATCH SERIES 3',
        'Apple IWATCH SERIES 4',
        'Apple IWATCH SERIES 5',
        'Apple IWATCH SERIES 6',
        'Apple IWATCH SERIES 7',
        'Apple IWATCH SERIES 8',
        'Apple IWATCH SERIES SE (2ND GEN)',
        'Apple IWATCH ULTRA',
        'Apple IWATCH ULTRA 2',
        'Samsung GALAXY WATCH 4',
        'Samsung GALAXY WATCH 4 CLASSIC',
        'Samsung GALAXY WATCH 5',
        'Samsung GALAXY WATCH 5 PRO',

    ]
    
    smartwatch_table = []

    for index, product_name in enumerate(product_names, start=1):
        print(f"\n*** Searching for '{product_name}' ***")
        results = get_product_info(product_name)
    
    # Check if results is not None
        if results is not None:
            # Extract prices and ensure there are at least three prices for highest and lowest
            prices_lowest = [float(product['price'].replace('₦', '').replace(',', '').replace('\xa0', '').replace('NGN', '')) for product in results['first_three_lowest']]
            prices_lowest += [0.0] * (3 - len(prices_lowest))

            prices_highest = [float(product['price'].replace('₦', '').replace(',', '').replace('\xa0', '').replace('NGN', '')) for product in results['first_three_highest']]
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
            8: 'Apple IWATCH SERIES SE (2ND GEN)',
            9: 'Apple IWATCH ULTRA',
            10: 'Apple IWATCH ULTRA 2',
            11: 'Samsung GALAXY WATCH 4',
            12: 'Samsung GALAXY WATCH 4 CLASSIC',
            13: 'Samsung GALAXY WATCH 5',
            14: 'Samsung GALAXY WATCH 5 PRO',
                # Add other product names here
        }.get(index, f"Unknown Product {index}")
    # Constructing the JavaScript format
        entry = {
            'id': index,
            'Pname': assigned_product_name,
            'Link': f"https://slot.ng/catalogsearch/result/?q={product_name.replace(' ', '+')}",
            'H1': f"{prices_highest[0]:,.0f}",
            'H2': f"{prices_highest[1]:,.0f}",
            'H3': f"{prices_highest[2]:,.0f}",
            'L1': f"{prices_lowest[0]:,.0f}",
            'L2': f"{prices_lowest[1]:,.0f}",
            'L3': f"{prices_lowest[2]:,.0f}",
            }

        smartwatch_table.append(entry)

        # Allow further testing by leaving the input part
    
    with open('smartwatchSLOT.js', 'w') as js_file:
                js_file.write("export const smartwatchTable = " + json.dumps(smartwatch_table, indent=2))

