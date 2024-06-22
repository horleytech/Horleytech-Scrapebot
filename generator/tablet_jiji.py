import time
import json
import requests
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from bs4 import BeautifulSoup

def get_product_info(product_name):
    # Function to scrape Jumia search results for the given product_name

    # Use a headless browser (Chrome in this case)
    # driver = webdriver.Chrome()

    base_url = 'https://jiji.ng/search?query='
    search_url = base_url + product_name.replace(' ', '%20')

    try:
        response = requests.get(search_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        product_elements = soup.find_all('div', class_='b-list-advert-base__data__header')

        if not product_elements:
            print(f"Product not available for '{product_name}'.")
            return {
                'first_three_lowest': [],
                'first_three_highest': []
            }

        product_data = []
        for element in product_elements:
            name_element = element.find('div', class_='b-advert-title-inner qa-advert-title b-advert-title-inner--div')
            price_element = element.find('div', class_='qa-advert-price')

            if name_element and price_element:
                
                if product_name in [
                    'AMAZON FIRE HD 10 PRO tablet',
                    'AMAZON FIRE HD 8 PRO tablet',
                    'BEBE Kids Tab B88 5G tablet',
                    ]:
                    name_words = name_element.text.lower().split()[:7]
                    input_words = product_name.lower().split()[:7]
                elif product_name in [
                    'new AMAZON FIRE HD 10 PRO tablet',
                    'new AMAZON FIRE HD 8 PRO tablet',
                    'new BEBE Kids Tab B88 5G tablet',
                    ]:
                    name_words = name_element.text.lower().split()[:6]
                    input_words = product_name.lower().split()[:6]

                elif product_name in [
                    'new apple IPAD AIR 256gb 4th GEN',
                    'NOKIA T10 tablet',
                    'NOKIA T20 tablet',
                    'apple NOKIA T21 tablet',
                    'new SAMSUNG TAB S9 ULTRA 5G',
                    'new SAMSUNG TAB S8 ULTRA',
                    'new SAMSUNG TAB S7 FE',
                    'new SAMSUNG TAB A7 LITE',
                    'new SAMSUNG TAB A8 tablet',
                    'new SAMSUNG TAB S6 LITE',
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

    except Exception as e:
        print(f"Error during the request: {e}")
        return None
    # finally:
    #     driver.quit()

    


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
        'new apple IPAD 10.2 10TH GEN, 10.9"',
         'new apple IPAD 10.2 5TH GEN, 10.9"',
         'new apple IPAD 10.2 6TH GEN, 10.9"',
         'new apple IPAD 10.2 9TH GEN, 10.9"',
         'new apple IPAD AIR 2ND GEN',
         'new apple IPAD AIR 4TH GEN',
         'new apple IPAD AIR 256 gb 5th GEN',
         'new apple IPAD AIR 256 gb 4th GEN',
         'new apple IPAD MINI 6',
         'new apple IPAD PRO 3RD GEN',
         'new apple IPAD PRO 4TH GEN',
         'new apple IPAD PRO 5TH GEN',
         'new apple IPAD PRO 6TH GEN',
         'new SAMSUNG TAB A7 LITE',
        'new SAMSUNG TAB A8 tablet',
        'new SAMSUNG TAB S6 LITE',
        'new SAMSUNG TAB S7 FE',
        'new SAMSUNG TAB S8',
        'new SAMSUNG TAB S8+',
        'new SAMSUNG TAB S8 ULTRA',
        'new SAMSUNG TAB S9 5G',
        'new SAMSUNG TAB S9 ULTRA 5G',
         'new NOKIA T10 tablet',
         'new NOKIA T20 tablet',
         'new NOKIA T21 tablet',
         'new AMAZON FIRE HD 10 PRO tablet',
         'new AMAZON FIRE HD 8 PRO tablet',
         'new BEBE Kids Tab B88 5G tablet',
        
    ]
    tablet_table = []

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
        1: 'IPAD 10TH GEN',
        2: 'IPAD 5TH GEN',
        3: 'IPAD 6TH GEN',
        4: 'IPAD 9TH GEN',
        5: 'IPAD AIR 2ND GEN',
        6: 'IPAD AIR 4TH GEN',
        7: 'IPAD AIR 5TH GEN',
        8: 'IPAD MINI 4TH GEN',
        9: 'IPAD MINI 6',
        10: 'IPAD PRO 3RD GEN',
        11: 'IPAD PRO 4TH GEN',
        12: 'IPAD PRO 5TH GEN',
        13: 'IPAD PRO 6TH GEN',
        14: 'SAMSUNG TAB A7 LITE',
        15: 'SAMSUNG TAB A8',
        16: 'SAMSUNG TAB S6 LITE',
        17: 'SAMSUNG TAB S7 FE',
        18: 'SAMSUNG TAB S8',
        19: 'SAMSUNG TAB S8 PLUS',
        20: 'SAMSUNG TAB S8 ULTRA',
        21: 'SAMSUNG TAB S9 5G',
        22: 'SAMSUNG TAB S9 ULTRA 5G',
        23: 'NOKIA T10',
        24: 'NOKIA T20',
        25: 'NOKIA T21',
        26: 'AMAZON FIRE HD 10 PRO',
        27: 'AMAZON FIRE HD 8 PRO',
        28: 'BEBE Kids Tab B88 5G',
            

                # Add other product names here
            }.get(index, f"Unknown Product {index}")


            # Constructing the JavaScript format
            entry = {
                'id': index,
                'Pname': assigned_product_name,
                'Link': f"https://jiji.ng/search?query={product_name.replace(' ', '+')}",
                'H1': f"{prices_highest[0]:,.0f}",
                'H2': f"{prices_highest[1]:,.0f}",
                'H3': f"{prices_highest[2]:,.0f}",
                'L1': f"{prices_lowest[0]:,.0f}",
                'L2': f"{prices_lowest[1]:,.0f}",
                'L3': f"{prices_lowest[2]:,.0f}",
            }

            tablet_table.append(entry)

    # Allow further testing by leaving the input part
    
    with open('src/constants/sites/jiji/tabletJIJI.js', 'w') as js_file:
        js_file.write("export const tabletTable = " + json.dumps(tablet_table, indent=2))


