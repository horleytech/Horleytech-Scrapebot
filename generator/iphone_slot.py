import requests
import json
from bs4 import BeautifulSoup
import re


def extract_storage(text):
    # Regex pattern to match storage sizes like '128GB', '256 GB', '1TB', '1 TB', '512GB'
    pattern = r'(\d+\s*[GT]B)'
    
    # Search for the storage size in the text
    match = re.search(pattern, text, re.IGNORECASE)
    
    if match:
        # Return the matched storage size in a normalized format (remove spaces and ensure consistent casing)
        return match.group(1).replace(" ", "").upper()
    else:
        # Return None if no storage size is found
        return None

def tokenize(name):
    # Lowercase the name and split by spaces and hyphens
    return set(name.lower().replace('-', ' ').split())

def get_product_info(product_name):
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

        input_tokens = tokenize(product_name)
        product_data = []

        for element in product_elements:
            name_element = element.find('h3', class_='product-name')
            price_element = element.find('span', class_='price')

            if name_element and price_element:
                scraped_name = name_element.text.lower()
                scraped_tokens = tokenize(scraped_name)

                # Compare the tokens
                if any(word in scraped_name for word in ["pouch", "case", "charger", "guard", "screen guard", "screenguard"]):
                    match_score = 0
                elif extract_storage(product_name) != extract_storage(scraped_name):
                    match_score = 0
                else:
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
        "apple iphone 15 pro max 256gb",
        "apple iphone 15 pro max 512gb",
        "apple iphone 15 pro max 1 tb",
        "apple iphone 15 pro 128gb",
        "apple iphone 15 pro 256gb",
        'apple iphone 15 128gb',
        "apple iphone 15 256gb",
        "apple iphone 14 pro max 128gb",
        "apple iphone 14 pro max 256gb",
        "apple iphone 14 pro max 512gb",
        "apple iphone 14 pro max 1tb",
        'apple iphone 14 pro 128gb',
        'apple iphone 14 pro 256gb',
        'apple iphone 14 pro 512gb',
        'apple iphone 14 pro 1 tb',
        'Apple IPhone 14 Plus 128gb',
        'Apple IPhone 14 Plus 256gb',
        "apple iphone 13 pro max 128gb",
        "apple iphone 13 pro max 256gb",
        "apple iphone 13 pro max 512gb",
        "apple iphone 13 pro max 1 tb",
        'apple iphone 13pro 128gb',
        'apple iphone 13 pro 256gb',
        'apple iphone 13 128gb',
        'apple iphone 13 256gb',
        "apple iphone 13 mini 256gb",
        "apple iphone 12 pro max 128gb",
        "apple iphone 12 pro max 256gb",
        "apple iphone 12 pro max 512gb",
        'apple iphone 12 pro 128gb',
        'apple iphone 12 pro 256gb',
        'apple iphone 12 128gb',
        'apple iphone 12 64gb',
        "apple iphone 11 pro max 256gb",
        "apple iphone 11 pro max 64gb",
        'apple IPhone 11 Pro 256gb',
        'Apple IPhone 11 Pro 64gb',
        'Apple IPhone 11 256gb',
        'Apple IPhone 11 128gb',
        'Apple IPhone 11 64gb',
        'apple iphone xs max 256gb',
        'apple iphone xs max 64gb',
        'apple iphone xr 128gb',
        'apple iphone xr 64gb',
        'apple iphone xs 128gb',
        'apple iphone xs 64gb',
        'Apple IPhone X 64GB',
        'Apple IPhone X 256GB',
        'Apple IPhone 8 plus 256gb',
        'Apple IPhone 8 plus 64gb',
        'Apple IPhone 8 64gb',
        'Apple IPhone 8 256gb',
        'Apple IPhone 7 plus 128gb',
        'Apple IPhone 7 plus 32gb',
        'Apple IPhone 7 128gb',
        'Apple IPhone 7 32gb',
    ]
    
    iphone_table = []

    for index, product_name in enumerate(product_names, start=1):
        print(f"\n*** Searching for '{product_name}' ***")
        results = get_product_info(product_name)
        
        # Extract prices and ensure there are at least three prices for highest and lowest
        prices_lowest = [float(product['price'].replace('₦', '').replace(',', '')) for product in results['first_three_lowest']]
        prices_lowest += [0.0] * (3 - len(prices_lowest))

        prices_highest = [float(product['price'].replace('₦', '').replace(',', '')) for product in results['first_three_highest']]
        prices_highest += [0.0] * (3 - len(prices_highest))

                # Assign specific product names based on the index
        assigned_product_name = {
            1: "apple iphone 15 pro max 256 gb",
            2: "apple iphone 15 pro max 512 gb",
            3: "apple iphone 15 pro max 1tb",
            4: "apple iphone 15 pro 128 gb",
            5: "apple iphone 15 pro 256 gb",
            6: 'apple iphone 15 128 gb',
            7: "apple iphone 15 256 gb",
            8: "apple iphone 14 pro max 128 gb",
            9: "apple iphone 14 pro max 256 gb",
            10: "apple iphone 14 pro max 512 gb",
            11: "apple iphone 14 pro max 1tb",
            12: 'apple iphone 14 pro 128 gb',
            13: 'apple iphone 14 pro 256 gb',
            14: 'apple iphone 14 pro 512 gb',
            15: 'apple iphone 14 pro 1 tb',
            16: 'Apple IPhone 14 Plus 128 gb',
            17: 'Apple IPhone 14 Plus 256 gb',
            18: "apple iphone 13 pro max 128 gb",
            19: "apple iphone 13 pro max 256 gb",
            20: "apple iphone 13 pro max 512 gb",
            21: "apple iphone 13 pro max 1 tb",
            22: 'apple iphone 13 pro 128 gb',
            23: 'apple iphone 13 pro 256 gb',
            24: 'apple iphone 13 128 gb',
            25: 'apple iphone 13 256 gb',
            26: "apple iphone 13 mini 256 gb",
            27: "apple iphone 12 pro max 128 gb",
            28: "apple iphone 12 pro max 256 gb",
            29: "apple iphone 12 pro max 512 gb",
            30: 'apple iphone 12 pro 128 gb',
            31: 'apple iphone 12 pro 256 gb',
            32: 'apple iphone 12 128 gb',
            33: 'apple iphone 12 64 gb',
            34: "apple iphone 11 pro max 256 gb",
            35: "apple iphone 11 pro max 64 gb",
            36: 'apple IPhone 11 Pro 256 gb',
            37: 'Apple IPhone 11 Pro  64 gb',
            38: 'Apple IPhone 11 256 gb',
            39: 'Apple IPhone 11 128 gb',
            40: 'Apple IPhone 11 64 gb',
            41: 'apple iphone xs max 256 gb',
            42: 'apple iphone xs max 64 gb',
            43: 'apple iphone xr 128 gb',
            44: 'apple iphone xr 64 gb',
            45: 'apple iphone xs 128 gb',
            46: 'apple iphone xs 64 gb',
            47: 'Apple IPhone X 64 GB',
            48: 'Apple IPhone X 256 GB',
            49: 'Apple IPhone 8 plus 256 gb',
            50: 'Apple IPhone 8 plus 64 gb',
            51: 'Apple IPhone 8 64 gb',
            52: 'Apple IPhone 8 256 gb',
            53: 'Apple IPhone 7 plus 128 gb',
            54: 'Apple IPhone 7 plus 32 gb',
            55: 'Apple IPhone 7 128 gb',
            56: 'Apple IPhone 7 32 gb',
            

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

        iphone_table.append(entry)

    with open('src/constants/sites/slot/iphoneSLOT.js', 'w') as js_file:
        js_file.write("export const iphoneTable = " + json.dumps(iphone_table, indent=2))

    
