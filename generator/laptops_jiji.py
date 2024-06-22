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
        # driver.get(search_url)

        # # Scroll down to load more products dynamically
        # for _ in range(15):  # Adjust the number of scrolls based on your needs
        #     driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        #     time.sleep(2)  # Adjust the sleep time if needed

        response = requests.get(search_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        # soup = BeautifulSoup(driver.page_source, 'html.parser')

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
                # Special case for "apple iphone 13 6.1" 128gb"
                if product_name in [
                    'New Laptop Apple MacBook Pro 2020 8GB Apple M1',
                    'new laptop Apple MacBook pro 2022 M2 16gb apple m2',
                    'new laptop Apple MacBook pro 2023 M2 max 14-inch',
                    'new laptop Apple MacBook pro 2023 M2 16-inch 16gb pro chip',
                    ]:
                    name_words = name_element.text.lower().split()[:9]
                    input_words = product_name.lower().split()[:9]

                elif product_name in [
                    'new laptop HP 15-DW1001NIA',
                    'New Laptop ASUS GAMING-FX506LH-HN0042W',
                    ]:
                    name_words = name_element.text.lower().split()[:3]
                    input_words = product_name.lower().split()[:3]


                elif product_name in [
                    'new laptop HP ELITEBOOK 830 G6',
                    'new laptop HP ELITEBOOK 840 G3',
                    'new laptop HP ELITEBOOK 840 G5',
                    'new laptop HP ELITEBOOK 840 G8',
                    'new laptop HP ELITEBOOK 840 G9',
                    'new laptop HP ELITEBOOK 850 G8',
                    'new laptop HP pavilion 15 8gb core i5',
                    'new laptop HP PROBOOK 440 G8',
                    'new laptop HP PROBOOK 440 G9',
                    'new laptop HP PROBOOK 440 G9',
                    'new laptop HP PROBOOK 450 G8',
                    'new laptop HP PROBOOK 640 G8',
                    'new laptop MICROSOFT SURFACE PRO 9',
                    'new laptop LENOVO IDEAPAD FLEX 5',
                    'new laptop LENOVO THINKPAD X1 Carbon Gen 9',
                    'new laptop ACER Predator Helios 300 PH315-55 2023',
                    'New Laptop ACER Predator Helios 300 PH315-55 Late 2022',
                    'New Laptop ACER Predator Triton 300 SE PT316-51s-7397',
                    'new laptop dell ALIENWARE M15 R5',

                    ]:
                    name_words = name_element.text.lower().split()[:6]
                    input_words = product_name.lower().split()[:6]

                elif product_name in [
                    'new laptop Apple MacBook pro 2021 M1 Max Chip',
                    'new laptop Apple MacBook pro M1 16gb pro Chip 2021',
                    'new laptop APPLE MACBOOK AIR 2015 8gb',
                    'new laptop APPLE MACBOOK AIR 2017 8gb',
                    'new laptop APPLE MACBOOK AIR 2018 8gb',
                    'new laptop APPLE MACBOOK AIR 2019 8gb',
                    'new laptop APPLE MACBOOK AIR 2020 8gb',
                    'new laptop APPLE MACBOOK AIR 2020 M1',
                    'new laptop APPLE MACBOOK AIR 2022 M2',
                    'new laptop APPLE MACBOOK AIR 2023 M2',
                    'new laptop HP ELITEBOOK X360 1030 G2',
                    'new laptop HP ELITEBOOK X360 1030 G3',
                    'new laptop HP ELITEBOOK X360 1040 G3',
                    'new laptop HP ELITEBOOK X360 1040 G6',
                    'new laptop HP ELITEBOOK 820 G3 8gb',
                    'new laptop HP ELITEBOOK 830 G8 8gb 512gb',
                    'New Laptop ACER Predator Triton 500 SE PT516-52s-99EL',
                    ]:
                    name_words = name_element.text.lower().split()[:7]
                    input_words = product_name.lower().split()[:7]
                else:
                    name_words = name_element.text.lower().split()[:5]
                    input_words = product_name.lower().split()[:5]

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
        # driver.quit()

    


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
         'Laptop APPLE MACBOOK PRO 2015',
         'laptop APPLE MACBOOK PRO 2016',
         'laptop APPLE MACBOOK PRO 2017 ',
         'APPLE MACBOOK PRO 2017 (15 inches)',
         'Laptop Apple MacBook Pro 2018 16GB Intel',
         'APPLE MACBOOK PRO INTEL 2018 (15 inches)',
         'Laptop Apple MacBook Pro 2019 Intel 15 inches',
         'Laptop Apple MacBook Pro 2019 Intel 13 inches',
         'New Laptop Apple MacBook Pro 2020 8GB Intel',
         'New Laptop Apple MacBook Pro 2020 8GB Apple M1',
         'new laptop Apple MacBook pro 2021 M1 Max Chip',
         'new laptop Apple MacBook pro M1 16gb pro Chip 2021',
         'new laptop Apple MacBook pro 2022 M2 16gb apple m2',
         'new laptop Apple MacBook pro 2023 M2 max 14-inch',
         'new laptop Apple MacBook pro 2023 M2 16-inch 16gb pro chip',
         'new laptop APPLE MACBOOK AIR 2015 8gb',
         'new laptop APPLE MACBOOK AIR 2017 8gb',
         'new laptop APPLE MACBOOK AIR 2018 8gb',
         'new laptop APPLE MACBOOK AIR 2019 8gb',
         'new laptop APPLE MACBOOK AIR 2020 8gb',
         'new laptop APPLE MACBOOK AIR 2020 M1',
         'new laptop APPLE MACBOOK AIR 2022 M2',
         'new laptop APPLE MACBOOK AIR 2023 M2',
         'new laptop HP 1040 G4',
         'new laptop HP 250 G8',
         'new laptop HP ELITEBOOK X360 1030 G2',
         'new laptop HP ELITEBOOK X360 1030 G3',
         'new laptop HP ELITEBOOK X360 1040 G3',
         'new laptop HP ELITEBOOK X360 1040 G6',
         'new laptop HP ELITEBOOK 820 G3 8gb',
         'new laptop HP ELITEBOOK 830 G6',
         'new laptop HP ELITEBOOK 830 G8 8gb 512gb',
         'new laptop HP ELITEBOOK 840 G3',
         'new laptop HP ELITEBOOK 840 G5',
         'new laptop HP ELITEBOOK 840 G8',
         'new laptop HP ELITEBOOK 840 G9',
         'new laptop HP ELITEBOOK 850 G8',
         'new laptop HP 15-DW1001NIA',
         'new laptop HP OMEN 16 16gb',
         'new laptop HP pavilion 15 8gb core i5',
         'HP PAVILION X360 CONVERTIBLE 14-DY1094NIA',
         'new laptop HP PROBOOK 440 G8',
         'new laptop HP PROBOOK 440 G9',
         'new laptop HP PROBOOK 450 G8',
         'new laptop HP PROBOOK 640 G8',
         'new laptop HP SPECTRE X360',
         'HP SPECTRE X360 14-EA0133NA LAPTOP',
         'new laptop HP STREAM 11 PRO',
         'new laptop HP VICTUS 16',
         'new laptop HP ZBOOK G6',
         'new laptop HP ZBOOK G5',
         'new laptop ZED AIR H3',
         'new laptop Samsung Galaxy Book S',
         'new laptop MICROSOFT SURFACE PRO 9',
         'new laptop LENOVO IDEAPAD 3 15ITL6',
         'new laptop LENOVO IDEAPAD FLEX 5',
         'new laptop LENOVO LEGION 7 16ITHG6',
         'new laptop LENOVO THINKBOOK 15 G2-ITL',
         'new laptop LENOVO THINKBOOK 15 G2-ITL 1165G7',
         'new laptop LENOVO THINKBOOK 15 IIL 1065G7',
         'new laptop LENOVO THINKPAD E14 Gen 4 1255U',
         'new laptop LENOVO THINKPAD E15 Gen 2 1135G7',
         'new laptop LENOVO THINKPAD E15 Gen 2 1165G7',
         'new laptop LENOVO THINKPAD X1 Carbon Gen 9',
         'new laptop LENOVO THINKPAD YOGA X1 TITANIUM Gen 1',
         'new laptop LENOVO V15-IGL',
         'new laptop LENOVO YOGA SLIM 7 14ITL05',
         'New Laptop ACER Predator Helios 300 PH315-54-74FG Gaming Notebook (2023)',
         'new laptop ACER Predator Helios 300 PH315-55 2023',
         'New Laptop ACER Predator Helios 300 PH315-55 Late 2022',
         'New Laptop ACER Predator Triton 300 SE PT316-51s-7397',
         'New Laptop ACER Predator Triton 500 SE PT516-52s-99EL',
         'New Laptop dell ALIENWARE M15 R5',
         'New Laptop ASUS ROG Zephyrus G14',
         'New Laptop ASUS GAMING-FX506LH-HN0042W',
         'New Laptop ASUS TUF DASH',
         'ASUS TUF GAMING FX706IH-H7214T',
         'New Laptop DELL G15 5511',
         'new laptop HP OMEN 16',
         'new laptop HP VICTUS 8gb',
         'new laptop MSI RAIDER GE76',
         'new laptop MSI Katana GF66',
         'New Laptop DELL G15 5511',
         'new laptop DELL INSPIRON 15 3511',
         'new laptop DELL LATITUDE 7300',
         'new laptop DELL LATITUDE 7410',
         'new laptop DELL LATITUDE 7420',
         'new laptop DELL PRECISION 5520', 
         'new laptop DELL VOSTRO 3400',
         'new laptop DELL VOSTRO 3510',
         'new laptop DELL XPS 15 9530',
         'new laptop DELL XPS 13 X360',
         'new laptop ASUS E210MA 4gb',
         'new laptop ASUS E410MA-EK1015T',
         'new laptop ASUS GAMING-FX506LH-HN0042W',
         'new laptop ASUS TUF DASH',
         'new laptop ASUS TUF GAMING FX706IH-H7214T',
         'new laptop ASUS VIVOBOOK X415FA',
         'new laptop ASUS X515FA-EJ185W',
         'new laptop ASUS ZENBOOK FLIP 14 OLED',
         'new laptop ASUS ZENBOOK- UX325EA-KG333T',    
         'new laptop ASUS ZENBOOK- UX425EA-KI464T',
         'new laptop ASUS ZENBOOK- UX425EA-KI979W',
         'new laptop dell ALIENWARE M15 R5',
        
    ]
    laptop_table = []

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
                1: 'APPLE MACBOOK PRO 2015',
                2: 'APPLE MACBOOK PRO 2016',
                3: 'APPLE MACBOOK PRO 2017 (13 inches)',
                4: 'APPLE MACBOOK PRO 2017 (15 inches)',
                5: 'APPLE MACBOOK PRO INTEL 2018 (13 inches)',
                6: 'APPLE MACBOOK PRO INTEL 2018 (15 inches)',
                7: 'APPLE MACBOOK PRO INTEL 2019 (13 inches)',
                8: 'APPLE MACBOOK PRO INTEL 2019 (15 inches)',
                9: 'APPLE MACBOOK PRO INTEL 2020',
                10: 'APPLE MACBOOK PRO M1 2020',
                11: 'APPLE MACBOOK PRO M1 MAX 2021',
                12: 'APPLE MACBOOK PRO M1 PRO 2021',
                13: 'APPLE MACBOOK PRO M2 2022',
                14: 'APPLE MACBOOK PRO M2 MAX 2023',
                15: 'APPLE MACBOOK PRO M2 PRO 2023',
                16: 'APPLE MACBOOK AIR 2015',
                17: 'APPLE MACBOOK AIR 2017',
                18: 'APPLE MACBOOK AIR 2018',
                19: 'APPLE MACBOOK AIR 2019',
                20: 'APPLE MACBOOK AIR INTEL 2020',
                21: 'APPLE MACBOOK AIR M1 2020',
                22: 'APPLE MACBOOK AIR M2 2022',
                23: 'APPLE MACBOOK AIR M2 2023',
                24: 'HP 1040 G4',
                25: 'HP 250 G8',
                26: 'HP ELITEBOOK 1030 G2',
                27: 'HP ELITEBOOK 1030 G3',
                28: 'HP ELITEBOOK 1040 G3',
                29: 'HP ELITEBOOK 1040 G6',
                30: 'HP ELITEBOOK 820 G3',
                31: 'HP ELITEBOOK 830 G6',
                32: 'HP ELITEBOOK 830 G8',
                33: 'HP ELITEBOOK 840 G3',
                34: 'HP ELITEBOOK 840 G5',
                35: 'HP ELITEBOOK 840 G8',
                36: 'HP ELITEBOOK 840 G9',
                37: 'HP ELITEBOOK 850 G8',
                38: 'HP LAPTOP 15-DW1001NIA',
                39: 'HP OMEN 16 GAMING LAPTOP',
                40: 'HP PAVILION',
                41: 'HP PAVILION X360 CONVERTIBLE 14-DY1094NIA',
                42: 'HP PROBOOK 440 G8',
                43: 'HP PROBOOK 440 G9',
                44: 'HP PROBOOK 450 G8',
                45: 'HP PROBOOK 640 G8',
                46: 'HP SPECTRE X360',
                47: 'HP SPECTRE X360 14-EA0133NA LAPTOP',
                48: 'HP STREAM 11 PRO',
                49: 'HP VICTUS GAMING LAPTOP',
                50: 'HP ZBOOK G6',
                51: 'HP ZBOOK G5',
                52: 'ZED AIR H3',
                53: 'Samsung Galaxy Book S',
                54: 'MICROSOFT SURFACE PRO 9',
                55: 'LENOVO IDEAPAD 3 15ITL6',
                56: 'LENOVO IDEAPAD FLEX 5 SERIES 14ITL05',
                57: 'LENOVO LEGION 7 SERIES 16ITHG6',
                58: 'LENOVO THINKBOOK 15 G2-ITL 1135G7',
                59: 'LENOVO THINKBOOK 15 G2-ITL 1165G7',
                60: 'LENOVO THINKBOOK 15 IIL 1065G7',
                61: 'LENOVO THINKPAD E14 Gen 4 1255U',
                62: 'LENOVO THINKPAD E15 Gen 2 1135G7',
                63: 'LENOVO THINKPAD E15 Gen 2 1165G7',
                64: 'LENOVO THINKPAD X1 Carbon Gen 9',
                65: 'LENOVO THINKPAD X1 TITANIUM YOGA Gen 1',
                66: 'LENOVO V15-IGL',
                67: 'LENOVO YOGA SLIM 7 14ITL05',
                68: 'ACER Predator Helios 300 PH315-54-74FG Gaming Notebook (2023)',
                69: 'ACER Predator Helios 300 PH315-55-70ZV Gaming Notebook (2023)',
                70: 'ACER Predator Helios 300 PH315-55-795C Gaming Notebook (Late 2022)',
                71: 'ACER Predator Triton 300 SE PT316-51s-7397 Gaming Notebook',
                72: 'ACER Predator Triton 500 SE PT516-52s-99EL Gaming Notebook (2022)',
                73: 'ALIENWARE M15 R5',
                74: 'ASUS G14, ROG Zephyrus',
                75: 'ASUS GAMING-FX506LH-HN0042W',
                76: 'ASUS TUF DASH GAMING',
                77: 'ASUS TUF GAMING FX706IH-H7214T',
                78: 'DELL G15',
                79: 'HP OMEN 16 GAMING LAPTOP',
                80: 'HP VICTUS GAMING LAPTOP',
                81: 'MSI GE76 RAIDER',
                82: 'MSI Katana GF66',
                83: 'DELL G15',
                84: 'DELL INSPIRON 15-3511',
                85: 'DELL LATITUDE 7300',
                86: 'DELL LATITUDE 7410',
                87: 'DELL LATITUDE 7420',
                88: 'DELL PRECISION 5520', 
                89: 'DELL VOSTRO 3400',
                90: 'DELL VOSTRO 3510',
                91: 'DELL XPS 15 9530',
                92: 'DELL XPS13 X360',
                93: 'ASUS E210MA-GJ068T',
                94: 'ASUS E410MA-EK1015T',
                95: 'ASUS GAMING-FX506LH-HN0042W',
                96: 'ASUS TUF DASH GAMING',
                97: 'ASUS TUF GAMING FX706IH-H7214T',
                98: 'ASUS VIVOBOOK',
                99: 'ASUS X515FA-EJ185W',
                101: 'ASUS ZENBOOK 14 FLIP OLED',
                102: 'ASUS ZENBOOK- UX325EA-KG333T',    
                103: 'ASUS ZENBOOK- UX425EA-KI464T',
                104: 'ASUS ZENBOOK- UX425EA-KI979W',
                105: 'ALIENWARE M15 R5',
            

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

            laptop_table.append(entry)

    # Allow further testing by leaving the input part
    
    with open('src/constants/sites/jiji/laptopJIJI.js', 'w') as js_file:
        js_file.write("export const laptopTable = " + json.dumps(laptop_table, indent=2))

