import requests
import json
import os
from bs4 import BeautifulSoup

def get_product_info(product_name):
    # Function to scrape justfones search results for the given product_name
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

        product_data = []
        for element in product_elements:
            name_element = element.find('h3', class_='product-item-name')
            price_element = element.find('span', class_='price-wrapper')
            

            if name_element and price_element:
                # Special case for "apple iphone 13 6.1" 128gb"
                if product_name in [
                    'samsung galaxy z fold 5 - 7.6" 1tb',
                    'samsung galaxy z fold 5 - 7.6" 512gb',
                    'samsung galaxy z fold 5 - 7.6" 256gb',
                    'samsung galaxy z fold 4 - 7.6" 512gb',
                    'samsung galaxy z fold 4 - 7.6" 256gb',
                    'samsung galaxy z fold 3 - 7.6" 512gb',
                    'samsung galaxy z fold 3 - 7.6" 256gb',
                    'samsung galaxy z fold 2 - 7.6" 256gb',
                    'samsung galaxy fold 5 - 7.6" 1tb',
                    'samsung galaxy fold 5 - 7.6" 512gb',
                    'samsung galaxy fold 5 - 7.6" 256gb',
                    'samsung galaxy fold 4 - 7.6" 512gb',
                    'samsung galaxy fold 4 - 7.6" 256gb',
                    'samsung galaxy fold 3 - 7.6" 512gb',
                    'samsung galaxy fold 3 - 7.6" 256gb',
                    'samsung galaxy fold 2 - 7.6" 256gb',
                    'samsung galaxy s23 ultra 512gb',
                    'samsung galaxy s23 ultra 256gb',
                    'samsung galaxy s22 ultra 512gb',
                    'samsung galaxy s22 ultra 256gb',
                    'samsung galaxy s22 ultra 128gb',
                    'samsung galaxy s22 plus 256gb',
                    'samsung galaxy s22+ 5G 128gb',
                    'samsung galaxy s21 ultra 256gb',
                    'samsung galaxy s21 ultra 128gb',
                    'samsung galaxy s21 plus 256gb',
                    'samsung galaxy s21 plus 128gb',
                    'samsung galaxy s21 plus 128gb',
                    'samsung galaxy s20 ultra 256gb',
                    'samsung galaxy s20 ultra 128gb',
                    'samsung galaxy s20 plus 256gb',
                    'samsung galaxy s20 plus 128gb',
                    'Samsung Galaxy S10 5G 256gb',
                    'Samsung Galaxy S10 6.1" 128gb',
                    'Samsung Galaxy S10 plus 128gb',
                    'Samsung Galaxy S8 plus 64GB',
                    'samsung galaxy s8 5.8" 64gb',
                    'samsung galaxy s7 edge 32gb',
                    'samsung galaxy z flip5- 512gb',
                    'samsung galaxy z flip5- 256gb',
                    'samsung galaxy z flip4- 256gb',
                    'samsung galaxy z flip3- 256gb',
                    'samsung galaxy z flip3- 128gb',   
                    'samsung galaxy note 10 6.3" 256gb',
                    'samsung galaxy note 9 128gb',
                    'samsung galaxy note 8 64gb',
                    'samsung galaxy a74- 6.4" 256gb',
                    'samsung galaxy a74- 6.4" 128gb',
                    'samsung galaxy a54- 6.4" 256gb',
                    'samsung galaxy a54- 6.4" 128gb',
                    'Samsung Galaxy A33 5G 256gb',
                    'Samsung Galaxy A33 5G 128gb',
                    'Samsung GALAXY A23-6.6" 128gb',
                    'Samsung Galaxy A13 5G 128GB',
                    'Samsung Galaxy A13 - 6.6" 64gb',
                    'samsung galaxy a03 core 32gb',
                    ]:
                    name_words = name_element.text.lower().split()[:4]
                    input_words = product_name.lower().split()[:4]
                else:
                    name_words = name_element.text.lower().split()[:5]
                    input_words = product_name.lower().split()[:5]
                    

                # Check if the first four words match
                if name_words == input_words:
                    price_text = price_element.text.strip()

                    # Handling price ranges
                    if ' - ' in price_text:
                        # Extracting the individual prices from the range
                        price_range = price_text.split(' - ')
                        
                        # Calculating the average of the range
                        average_price = sum([float(p.replace('₦', '').replace(',', '')) for p in price_range]) / len(price_range)
                        price = f'₦ {average_price:,.0f}'
                    else:
                        # For single prices, just clean up the formatting
                        price = price_text.replace('₦', '').replace(',', '')
                        price = f'₦ {float(price):,.0f}'

                    product_data.append({'price': price})

        # Sort products by price
        sorted_products = sorted(product_data, key=lambda x: float(str(x['price']).replace('₦', '').replace(',', '')))

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
            print(f"Price: {product['price']}")
    else:
        print(f"\nProduct not Found.")


if __name__ == "__main__":
    
    product_names = [        
        'samsung galaxy z fold 5 - 7.6" 1tb',
        'samsung galaxy z fold 5 - 7.6" 512gb',
        'samsung galaxy z fold 5 - 7.6" 256gb',
        'samsung galaxy z fold 4 - 7.6" 512gb',
        'samsung galaxy z fold 4 - 7.6" 256gb',
        'samsung galaxy z fold 3 - 7.6" 512gb',
        'samsung galaxy z fold 3 - 7.6" 256gb',
        'samsung galaxy z fold 2 - 7.6" 256gb',
        'samsung galaxy s23 ultra 512gb',
        'samsung galaxy s23 ultra 256gb',
        'samsung galaxy s22 ultra 512gb',
        'samsung galaxy s22 ultra 256gb',
        'samsung galaxy s22 ultra 128gb',
        'samsung galaxy s22 plus 256gb',
        'samsung galaxy s22+ 5G 128gb',
        'samsung galaxy s21 ultra 256gb',
        'samsung galaxy s21 ultra 128gb',
        'samsung galaxy s21 plus 256gb',
        'samsung galaxy s21 plus 128gb',
        'samsung galaxy s20 ultra 256gb',
        'samsung galaxy s20 ultra 128gb',
        'samsung galaxy s20 plus 256gb',
        'samsung galaxy s20 plus 128gb',
        'Samsung Galaxy S10 5G 256gb',
        'Samsung Galaxy S10 6.1" 128gb',
        'Samsung Galaxy S10 plus 128gb',
        'Samsung Galaxy S9 5.8" 64GB',
        'Samsung Galaxy S8 plus 64GB',
        'samsung galaxy s8 5.8" 64gb',
        'samsung galaxy s7 edge 32gb',
        'samsung galaxy z flip5- 512gb',
        'samsung galaxy z flip5- 256gb',
        'samsung galaxy z flip4- 256gb',
        'samsung galaxy z flip3- 256gb',
        'samsung galaxy z flip3- 128gb',
        'samsung galaxy note 20 ultra 5g 256gb',
        'samsung galaxy note 20 ultra 5g 128gb',
        'samsung galaxy note10 plus 5g 256gb',
        'samsung galaxy note10 plus 5g 128gb',
        'samsung galaxy note 10 6.3" 256gb',
        'samsung galaxy note 9 128gb',
        'samsung galaxy note 8 64gb',
        'samsung galaxy a74- 6.4" 256gb',
        'samsung galaxy a74- 6.4" 128gb',
        'samsung galaxy a54- 6.4" 256gb',
        'samsung galaxy a54- 6.4" 128gb',
        'Samsung Galaxy A34 5G 6.4" 256gb',
        'Samsung Galaxy A34 5G 6.4" 128gb',
        'Samsung Galaxy A14 - 6.6" 128gb',
        'Samsung Galaxy A14 - 6.6" 64gb',
        'Samsung Galaxy A04s - 6.5" 128gb',
        'samsung galaxy a04s - 6.5" 64gb',
        'Samsung Galaxy A73 5G 6.5" 256gb',
        'Samsung Galaxy A73 5G 6.5" 128gb',
        'Samsung Galaxy A53 5G 6.5" 256gb',
        'Samsung Galaxy A53 5G 6.5" 128gb',
        'Samsung Galaxy A33 5G 256gb',
        'Samsung Galaxy A33 5G 128gb',
        'Samsung GALAXY A23-6.6" 128gb',
        'Samsung Galaxy A13 5G 128GB',
        'Samsung Galaxy A13 - 6.6" 64gb',
        'samsung galaxy a03 core 32gb',
        'samsung galaxy fold 5 - 7.6" 1tb',
        'samsung galaxy fold 5 - 7.6" 512gb',
        'samsung galaxy fold 5 - 7.6" 256gb',
        'samsung galaxy fold 4 - 7.6" 512gb',
        'samsung galaxy fold 4 - 7.6" 256gb',
        'samsung galaxy fold 3 - 7.6" 512gb',
        'samsung galaxy fold 3 - 7.6" 256gb',
        'samsung galaxy fold 2 - 7.6" 256gb',
        
    ]
    Samsung_table = []

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
        1: 'new samsung galaxy z fold 5 1 tb',
        2: 'samsung galaxy z fold 5 512 gb',
        3: 'samsung galaxy z fold 5 256 gb',
        4: 'samsung galaxy z fold4 512 gb',
        5: 'samsung galaxy z fold4 256 gb',
        6: 'samsung galaxy z fold3 512 gb',
        7: 'samsung galaxy z fold3 256 gb',
        8: 'samsung galaxy z fold 2 256 gb',
        9: 'samsung galaxy s23 ultra 512 gb',
        10: 'samsung galaxy s23 ultra 256 gb',
        11: 'samsung galaxy s22 ultra 512 gb',
        12: 'samsung galaxy s22 ultra 256 gb',
        13: 'samsung galaxy s22 ultra 128 gb',
        14: 'Samsung Galaxy S22+ 5G 256 gb',
        15: 'samsung galaxy s22+ 5G 128 gb',
        16: 'samsung galaxy s21 ultra 256 gb',
        17: 'samsung galaxy s21 ultra 128 gb',
        18: 'samsung galaxy s21+ 256 gb',
        19: 'samsung galaxy s21+ 128 gb',
        20: 'samsung galaxy s20 ultra 256 gb',
        21: 'samsung galaxy s20 ultra 128 gb',
        22: 'samsung galaxy s20+ 256 gb',
        23: 'samsung galaxy s20+ 128 gb',
        24: 'Samsung Galaxy S10 5G 256 gb',
        25: 'Samsung Galaxy S10 128 gb',
        26: 'Samsung Galaxy S10 plus 128 gb',
        27: 'Samsung Galaxy S9 64 GB',
        28: 'Samsung Galaxy S8 plus 64 GB',
        29: 'samsung galaxy s8 64 gb',
        30: 'samsung galaxy s7 edge 32 gb',
        31: 'samsung galaxy z flip 5 512 gb',
        32: 'samsung galaxy z flip 5 256 gb',
        33: 'samsung galaxy z flip4 256 gb',
        34: 'samsung galaxy z flip 3 256 gb',
        35: 'samsung galaxy z flip 3 128 gb',
        36: 'samsung galaxy note 20 ultra 5g 256 gb',
        37: 'samsung galaxy note 20 ultra 5g 128 gb',
        38: 'samsung galaxy note10 plus 5g 256 gb',
        39: 'samsung galaxy note10 plus 5g 128 gb',
        40: 'samsung galaxy note 10 256 gb',
        41: 'samsung galaxy note 9 128 gb',
        42: 'samsung galaxy note 8 64 gb',
        43: 'samsung galaxy a74 5g 256 gb',
        44: 'samsung galaxy a74 5g 128 gb',
        45: 'samsung galaxy a54 5g 256 gb',
        46: 'samsung galaxy a54 5g 128 gb',
        47: 'Samsung Galaxy A34 5G 256 gb',
        48: 'Samsung Galaxy A34 5G 128 gb',
        49: 'Samsung Galaxy A14 128 gb',
        50: 'Samsung Galaxy A14 64 gb',
        51: 'Samsung Galaxy A04s 128 gb',
        52: 'samsung galaxy a04s 64 gb',
        53: 'Samsung Galaxy A73 5G 256 gb',
        54: 'Samsung Galaxy A73 5G 128 gb',
        55: 'Samsung Galaxy A53 5G 256 gb',
        56: 'Samsung Galaxy A53 5G 128 gb',
        57: 'Samsung Galaxy A33 5G 256 gb',
        58: 'Samsung Galaxy A33 5G 128 gb',
        59: 'Samsung GALAXY A23 128 gb',
        60: 'Samsung Galaxy A13 5G 128 GB',
        61: 'Samsung Galaxy A13 64 gb',
        62: 'samsung galaxy a03 core 32 gb',
        63: 'samsung galaxy fold 5 - 7.6" 1tb',
        64: 'samsung galaxy fold 5 - 7.6" 512gb',
        65: 'samsung galaxy fold 5 - 7.6" 256gb',
        66: 'samsung galaxy fold 4 - 7.6" 512gb',
        67: 'samsung galaxy fold 4 - 7.6" 256gb',
        68: 'samsung galaxy fold 3 - 7.6" 512gb',
        69: 'samsung galaxy fold 3 - 7.6" 256gb',
        70: 'samsung galaxy fold 2 - 7.6" 256gb',
            

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

        Samsung_table.append(entry)

    # os.chdir('..')
    with open('src/constants/sites/justfone/samsungJUSTPHONE.js', 'w') as js_file:
        js_file.write("export const samsungTable = " + json.dumps(Samsung_table, indent=2))
    
